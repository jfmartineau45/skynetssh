import React, { useRef } from "react";
import type { SplitNode } from "../../types/models";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { TerminalPane } from "./TerminalPane";

interface Props {
  tabId: string;
  node: SplitNode;
  activePaneId: string;
}

export const SplitPaneNode: React.FC<Props> = ({
  tabId,
  node,
  activePaneId,
}) => {
  const { resizeSplit } = useWorkspaceStore();
  const wrapperRef = useRef<HTMLDivElement>(null);

  if (node.type === "leaf") {
    return (
      <TerminalPane
        tabId={tabId}
        pane={node.pane}
        isActive={node.pane.id === activePaneId}
      />
    );
  }

  const isHorizontal = node.direction === "horizontal";

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();

    const onMove = (moveEvent: MouseEvent) => {
      const ratio = isHorizontal
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height;
      resizeSplit(tabId, node.id, ratio);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={wrapperRef}
      className={`flex w-full h-full min-w-0 min-h-0 ${
        isHorizontal ? "flex-row" : "flex-col"
      }`}
    >
      <div
        style={{
          [isHorizontal ? "width" : "height"]: `${node.ratio * 100}%`,
        }}
        className="min-w-0 min-h-0 overflow-hidden"
      >
        <SplitPaneNode
          tabId={tabId}
          node={node.first}
          activePaneId={activePaneId}
        />
      </div>

      {/* Interactive Split Drag Handle */}
      <div
        onMouseDown={onDragStart}
        className={`shrink-0 bg-[var(--border-subtle)] hover:bg-[var(--accent-primary)] transition-colors z-10 ${
          isHorizontal
            ? "w-1 cursor-col-resize"
            : "h-1 cursor-row-resize"
        }`}
      />

      <div
        style={{
          [isHorizontal ? "width" : "height"]: `${(1 - node.ratio) * 100}%`,
        }}
        className="min-w-0 min-h-0 overflow-hidden"
      >
        <SplitPaneNode
          tabId={tabId}
          node={node.second}
          activePaneId={activePaneId}
        />
      </div>
    </div>
  );
};
