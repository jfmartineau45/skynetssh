use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use tauri::AppHandle;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};

use crate::models::{ActiveTunnelRuntime, TunnelRecord};
use crate::ssh::{RemoteForwardTarget, SshPool};
use crate::vault::VaultEngine;

struct RunningTunnel {
    active_connections: Arc<AtomicUsize>,
    bytes_in: Arc<AtomicU64>,
    bytes_out: Arc<AtomicU64>,
    stop_tx: Option<oneshot::Sender<()>>,
}

#[derive(Clone, Default)]
pub struct TunnelManager {
    running: Arc<Mutex<HashMap<String, RunningTunnel>>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn list_active(&self) -> Vec<ActiveTunnelRuntime> {
        let guard = self.running.lock().await;
        guard
            .iter()
            .map(|(id, rt)| ActiveTunnelRuntime {
                tunnel_id: id.clone(),
                status: "running".into(),
                active_connections: rt.active_connections.load(Ordering::Relaxed),
                bytes_in: rt.bytes_in.load(Ordering::Relaxed),
                bytes_out: rt.bytes_out.load(Ordering::Relaxed),
                error: None,
            })
            .collect()
    }

    pub async fn stop(&self, tunnel_id: &str) -> Result<()> {
        if let Some(mut rt) = self.running.lock().await.remove(tunnel_id) {
            if let Some(tx) = rt.stop_tx.take() {
                let _ = tx.send(());
            }
        }
        Ok(())
    }

    pub async fn stop_all(&self) {
        let drained: Vec<_> = self.running.lock().await.drain().collect();
        for (_, mut rt) in drained {
            if let Some(tx) = rt.stop_tx.take() {
                let _ = tx.send(());
            }
        }
    }

    pub async fn start(
        &self,
        rule: TunnelRecord,
        pool: SshPool,
        vault: Arc<std::sync::Mutex<VaultEngine>>,
        app_handle: AppHandle,
    ) -> Result<ActiveTunnelRuntime> {
        self.stop(&rule.id).await?;

        let active_connections = Arc::new(AtomicUsize::new(0));
        let bytes_in = Arc::new(AtomicU64::new(0));
        let bytes_out = Arc::new(AtomicU64::new(0));
        let (stop_tx, mut stop_rx) = oneshot::channel::<()>();

        match rule.tunnel_type.as_str() {
            "local" | "dynamic" => {
                let ssh_handle = pool
                    .get_or_connect(&rule.host_id, vault, Some(app_handle))
                    .await?;
                let bind_addr = format!("{}:{}", rule.bind_address, rule.bind_port);
                let listener = TcpListener::bind(&bind_addr)
                    .await
                    .with_context(|| format!("Failed to bind local port {bind_addr}"))?;

                let is_dynamic = rule.tunnel_type == "dynamic";
                let target_host = rule
                    .target_host
                    .clone()
                    .unwrap_or_else(|| "127.0.0.1".into());
                let target_port = rule.target_port.unwrap_or(80);

                let conns_clone = active_connections.clone();
                let in_clone = bytes_in.clone();
                let out_clone = bytes_out.clone();

                tokio::spawn(async move {
                    loop {
                        tokio::select! {
                            _ = &mut stop_rx => break,
                            accept_res = listener.accept() => {
                                let Ok((socket, peer)) = accept_res else { continue };
                                let handle = ssh_handle.clone();
                                let th = target_host.clone();
                                let tp = target_port;
                                let c_cnt = conns_clone.clone();
                                let b_in = in_clone.clone();
                                let b_out = out_clone.clone();

                                tokio::spawn(async move {
                                    c_cnt.fetch_add(1, Ordering::Relaxed);
                                    if is_dynamic {
                                        let _ = handle_socks5_connection(
                                            socket,
                                            peer.ip().to_string(),
                                            peer.port() as u32,
                                            handle,
                                            b_in,
                                            b_out,
                                        )
                                        .await;
                                    } else if let Ok(ch) = handle
                                        .channel_open_direct_tcpip(
                                            &th,
                                            tp as u32,
                                            &peer.ip().to_string(),
                                            peer.port() as u32,
                                        )
                                        .await
                                    {
                                        let _ = pipe_bidirectional(socket, ch.into_stream(), b_in, b_out).await;
                                    }
                                    c_cnt.fetch_sub(1, Ordering::Relaxed);
                                });
                            }
                        }
                    }
                });
            }
            "remote" => {
                let fwd_target = RemoteForwardTarget {
                    target_host: rule
                        .target_host
                        .clone()
                        .unwrap_or_else(|| "127.0.0.1".into()),
                    target_port: rule.target_port.unwrap_or(80),
                    active_connections: active_connections.clone(),
                    bytes_in: bytes_in.clone(),
                    bytes_out: bytes_out.clone(),
                };
                let mut dedicated = pool
                    .connect_dedicated_with_forward(
                        &rule.host_id,
                        vault,
                        Some(app_handle),
                        fwd_target,
                    )
                    .await?;
                dedicated
                    .tcpip_forward(&rule.bind_address, rule.bind_port as u32)
                    .await
                    .context("Server denied remote tcpip-forward request")?;

                let bind_addr_copy = rule.bind_address.clone();
                let bind_port_copy = rule.bind_port as u32;
                tokio::spawn(async move {
                    let _ = (&mut stop_rx).await;
                    let _ = dedicated
                        .cancel_tcpip_forward(&bind_addr_copy, bind_port_copy)
                        .await;
                });
            }
            other => return Err(anyhow!("Unknown tunnel type: {other}")),
        }

        let runtime = ActiveTunnelRuntime {
            tunnel_id: rule.id.clone(),
            status: "running".into(),
            active_connections: 0,
            bytes_in: 0,
            bytes_out: 0,
            error: None,
        };

        self.running.lock().await.insert(
            rule.id,
            RunningTunnel {
                active_connections,
                bytes_in,
                bytes_out,
                stop_tx: Some(stop_tx),
            },
        );

        Ok(runtime)
    }
}

async fn pipe_bidirectional<S1, S2>(
    mut a: S1,
    mut b: S2,
    bytes_in: Arc<AtomicU64>,
    bytes_out: Arc<AtomicU64>,
) -> Result<()>
where
    S1: AsyncRead + AsyncWrite + Unpin,
    S2: AsyncRead + AsyncWrite + Unpin,
{
    let (up, down) = tokio::io::copy_bidirectional(&mut a, &mut b).await?;
    bytes_out.fetch_add(up, Ordering::Relaxed);
    bytes_in.fetch_add(down, Ordering::Relaxed);
    Ok(())
}

/// Parses the RFC 1928 SOCKS5 greeting and CONNECT request, returning `(dest_host, dest_port)`.
pub async fn negotiate_socks5_target<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
) -> Result<(String, u32)> {
    let mut hdr = [0u8; 2];
    stream.read_exact(&mut hdr).await?;
    if hdr[0] != 0x05 {
        return Err(anyhow!("Not SOCKS5"));
    }
    let mut methods = vec![0u8; hdr[1] as usize];
    stream.read_exact(&mut methods).await?;
    stream.write_all(&[0x05, 0x00]).await?;

    let mut req = [0u8; 4];
    stream.read_exact(&mut req).await?;
    if req[1] != 0x01 {
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Err(anyhow!("Unsupported SOCKS5 command"));
    }

    let dest_host = match req[3] {
        0x01 => {
            let mut ip = [0u8; 4];
            stream.read_exact(&mut ip).await?;
            Ipv4Addr::from(ip).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            let mut domain = vec![0u8; len[0] as usize];
            stream.read_exact(&mut domain).await?;
            String::from_utf8(domain)?
        }
        0x04 => {
            let mut ip = [0u8; 16];
            stream.read_exact(&mut ip).await?;
            Ipv6Addr::from(ip).to_string()
        }
        _ => return Err(anyhow!("Unsupported SOCKS5 address type")),
    };

    let mut port_buf = [0u8; 2];
    stream.read_exact(&mut port_buf).await?;
    Ok((dest_host, u16::from_be_bytes(port_buf) as u32))
}

async fn handle_socks5_connection(
    mut stream: TcpStream,
    origin_ip: String,
    origin_port: u32,
    ssh_handle: Arc<russh::client::Handle<crate::ssh::SshClientHandler>>,
    bytes_in: Arc<AtomicU64>,
    bytes_out: Arc<AtomicU64>,
) -> Result<()> {
    let (dest_host, dest_port) = negotiate_socks5_target(&mut stream).await?;

    match ssh_handle
        .channel_open_direct_tcpip(&dest_host, dest_port, &origin_ip, origin_port)
        .await
    {
        Ok(channel) => {
            stream
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            pipe_bidirectional(stream, channel.into_stream(), bytes_in, bytes_out).await?;
            Ok(())
        }
        Err(e) => {
            let _ = stream
                .write_all(&[0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await;
            Err(anyhow!("SSH direct-tcpip failed: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_socks5_domain_handshake() {
        let (mut client, mut server) = tokio::io::duplex(256);

        tokio::spawn(async move {
            // Greeting: VER 5, 1 method (0x00 No Auth)
            client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
            let mut reply = [0u8; 2];
            client.read_exact(&mut reply).await.unwrap();
            assert_eq!(reply, [0x05, 0x00]);

            // CONNECT internal.db.local:5432
            let host = b"internal.db.local";
            let mut req = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
            req.extend_from_slice(host);
            req.extend_from_slice(&5432u16.to_be_bytes());
            client.write_all(&req).await.unwrap();
        });

        let (host, port) = negotiate_socks5_target(&mut server).await.unwrap();
        assert_eq!(host, "internal.db.local");
        assert_eq!(port, 5432);
    }
}
