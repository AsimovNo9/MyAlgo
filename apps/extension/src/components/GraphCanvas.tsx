import React from 'react';
import type {
  GraphInspectorEdge,
  GraphInspectorNode,
  GraphModeOverlay,
} from '../lib/extension-helpers';

type GraphCanvasProps = {
  nodes: GraphInspectorNode[];
  edges: GraphInspectorEdge[];
  modeOverlay: GraphModeOverlay;
  searchQuery?: string;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onNodeSelect?: (nodeId: string) => void;
  onEdgeSelect?: (edgeId: string) => void;
  height?: number;
  compact?: boolean;
  focusOnly?: boolean;
  layoutMode?: 'network' | 'lineage';
};

type PositionedNode = GraphInspectorNode & {
  x: number;
  y: number;
  degree: number;
  modeMember: boolean;
  modeConnected: boolean;
  searchMatch: boolean;
};

const WIDTH = 1000;
const HEIGHT = 680;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

const hashString = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const kindRing = (kind: string): number => {
  switch (kind) {
    case 'user':
    case 'objective':
      return 0;
    case 'concept':
    case 'topic':
      return 1;
    case 'creator':
      return 2;
    case 'content':
      return 3;
    default:
      return 2;
  }
};

const nodeFill = (kind: string, selected: boolean, modeMember: boolean): string => {
  if (selected) return '#facc15';
  if (modeMember) return '#f59e0b';
  switch (kind) {
    case 'concept':
      return '#a78bfa';
    case 'topic':
      return '#22d3ee';
    case 'creator':
      return '#fbbf24';
    case 'content':
      return '#60a5fa';
    case 'objective':
      return '#34d399';
    case 'user':
      return '#fb7185';
    default:
      return '#94a3b8';
  }
};

const compareNodePriority = (
  left: GraphInspectorNode,
  right: GraphInspectorNode,
  degreeByNode: Map<string, number>,
  memberIds: Set<string>,
  connectedIds: Set<string>,
): number => (
  Number(memberIds.has(right.id)) - Number(memberIds.has(left.id))
  || Number(connectedIds.has(right.id)) - Number(connectedIds.has(left.id))
  || (degreeByNode.get(right.id) ?? 0) - (degreeByNode.get(left.id) ?? 0)
  || right.supportCount - left.supportCount
  || left.kind.localeCompare(right.kind)
  || left.label.localeCompare(right.label)
  || left.id.localeCompare(right.id)
);

export function GraphCanvas({
  nodes,
  edges,
  modeOverlay,
  searchQuery = '',
  selectedNodeId = null,
  selectedEdgeId = null,
  onNodeSelect,
  onEdgeSelect,
  height = 620,
  compact = false,
  focusOnly = false,
  layoutMode = 'network',
}: GraphCanvasProps) {
  const [zoom, setZoom] = React.useState(compact ? 1.25 : 1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const layout = React.useMemo(() => {
    const degreeByNode = new Map<string, number>();
    for (const edge of edges) {
      degreeByNode.set(edge.sourceNodeId, (degreeByNode.get(edge.sourceNodeId) ?? 0) + 1);
      degreeByNode.set(edge.targetNodeId, (degreeByNode.get(edge.targetNodeId) ?? 0) + 1);
    }

    const memberIds = new Set(modeOverlay.memberNodeIds);
    const connectedIds = new Set(modeOverlay.connectedNodeIds);
    const modeActive = modeOverlay.modeId !== 'all';
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const priorityIds = new Set<string>();
    if (selectedNodeId) priorityIds.add(selectedNodeId);
    if (selectedEdgeId) {
      const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
      if (selectedEdge) {
        priorityIds.add(selectedEdge.sourceNodeId);
        priorityIds.add(selectedEdge.targetNodeId);
      }
    }
    if (normalizedQuery) {
      for (const node of nodes) {
        if (
          node.label.toLowerCase().includes(normalizedQuery)
          || node.id.toLowerCase().includes(normalizedQuery)
          || node.kind.toLowerCase().includes(normalizedQuery)
        ) {
          priorityIds.add(node.id);
        }
      }
    }
    const searchMatchIds = new Set<string>();
    if (normalizedQuery) {
      for (const node of nodes) {
        if (
          node.label.toLowerCase().includes(normalizedQuery)
          || node.id.toLowerCase().includes(normalizedQuery)
          || node.kind.toLowerCase().includes(normalizedQuery)
        ) {
          searchMatchIds.add(node.id);
        }
      }
    }

    const focusNodeIds = new Set<string>();
    const focusEdgeIds = new Set<string>();
    if (modeActive) {
      for (const nodeId of connectedIds) focusNodeIds.add(nodeId);
      for (const edgeId of modeOverlay.connectedEdgeIds) focusEdgeIds.add(edgeId);
    }
    if (searchMatchIds.size > 0) {
      for (const nodeId of searchMatchIds) focusNodeIds.add(nodeId);
      for (const edge of edges) {
        if (!searchMatchIds.has(edge.sourceNodeId) && !searchMatchIds.has(edge.targetNodeId)) continue;
        focusEdgeIds.add(edge.id);
        focusNodeIds.add(edge.sourceNodeId);
        focusNodeIds.add(edge.targetNodeId);
      }
    }
    if (selectedNodeId) {
      focusNodeIds.add(selectedNodeId);
      for (const edge of edges) {
        if (edge.sourceNodeId !== selectedNodeId && edge.targetNodeId !== selectedNodeId) continue;
        focusEdgeIds.add(edge.id);
        focusNodeIds.add(edge.sourceNodeId);
        focusNodeIds.add(edge.targetNodeId);
      }
    }
    if (selectedEdgeId) {
      const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
      if (selectedEdge) {
        focusEdgeIds.add(selectedEdge.id);
        focusNodeIds.add(selectedEdge.sourceNodeId);
        focusNodeIds.add(selectedEdge.targetNodeId);
      }
    }

    const focusIsActive = focusOnly && (
      modeActive
      || normalizedQuery.length > 0
      || Boolean(selectedNodeId)
      || Boolean(selectedEdgeId)
    );
    const lineageMode = layoutMode === 'lineage' && !compact;
    let hiddenIsolatedCreatorCount = 0;
    const lineageContextNodeIds = new Set<string>();
    if (lineageMode) {
      const nonContentIds = new Set(nodes.filter((node) => node.kind !== 'content').map((node) => node.id));
      const higherLevelConnectedIds = new Set<string>();
      for (const edge of edges) {
        if (!nonContentIds.has(edge.sourceNodeId) || !nonContentIds.has(edge.targetNodeId)) continue;
        higherLevelConnectedIds.add(edge.sourceNodeId);
        higherLevelConnectedIds.add(edge.targetNodeId);
      }

      const allIsolatedCreators = nodes
        .filter((node) => (
          node.kind === 'creator'
          && !higherLevelConnectedIds.has(node.id)
        ))
        .sort((left, right) => (
          (degreeByNode.get(right.id) ?? 0) - (degreeByNode.get(left.id) ?? 0)
          || right.supportCount - left.supportCount
          || left.label.localeCompare(right.label)
          || left.id.localeCompare(right.id)
        ));
      const isolatedCreators = allIsolatedCreators.slice(0, 18);
      hiddenIsolatedCreatorCount = Math.max(0, allIsolatedCreators.length - isolatedCreators.length);
      const overviewCreatorIds = new Set(isolatedCreators.map((creator) => creator.id));
      for (const creatorId of higherLevelConnectedIds) {
        if (nodes.some((node) => node.id === creatorId && node.kind === 'creator')) {
          overviewCreatorIds.add(creatorId);
        }
      }

      const previewContentIds = new Set<string>();
      for (const creatorId of overviewCreatorIds) {
        const contentCandidates = edges
          .filter((edge) => (
            edge.relation === 'created_by'
            && edge.targetNodeId === creatorId
          ))
          .map((edge) => nodes.find((node) => node.id === edge.sourceNodeId))
          .filter((node): node is GraphInspectorNode => Boolean(node && node.kind === 'content'))
          .sort((left, right) => (
            right.supportCount - left.supportCount
            || left.label.localeCompare(right.label)
            || left.id.localeCompare(right.id)
          ))
          .slice(0, 3);
        for (const content of contentCandidates) previewContentIds.add(content.id);
      }

      for (const node of nodes) {
        if (node.kind === 'content') {
          if (focusNodeIds.has(node.id) || previewContentIds.has(node.id)) {
            lineageContextNodeIds.add(node.id);
          }
          continue;
        }
        if (
          node.kind !== 'creator'
          || higherLevelConnectedIds.has(node.id)
          || overviewCreatorIds.has(node.id)
          || focusNodeIds.has(node.id)
        ) {
          lineageContextNodeIds.add(node.id);
        }
      }
    }
    const candidateNodes = focusIsActive && focusNodeIds.size > 0
      ? nodes.filter((node) => focusNodeIds.has(node.id))
      : lineageMode
        ? nodes.filter((node) => lineageContextNodeIds.has(node.id))
        : nodes;
    const candidateNodeIds = new Set(candidateNodes.map((node) => node.id));
    const candidateEdges = focusIsActive && focusNodeIds.size > 0
      ? edges.filter((edge) => (
          focusNodeIds.has(edge.sourceNodeId)
          && focusNodeIds.has(edge.targetNodeId)
          && (focusEdgeIds.size === 0 || focusEdgeIds.has(edge.id))
        ))
      : lineageMode
        ? edges.filter((edge) => candidateNodeIds.has(edge.sourceNodeId) && candidateNodeIds.has(edge.targetNodeId))
        : edges;

    const capacity = compact ? 24 : 320;
    const prioritized = [...candidateNodes]
      .sort((left, right) => (
        Number(priorityIds.has(right.id)) - Number(priorityIds.has(left.id))
        || compareNodePriority(left, right, degreeByNode, memberIds, connectedIds)
      ))
      .slice(0, capacity);

    const visibleIds = new Set(prioritized.map((node) => node.id));
    const visibleEdges = candidateEdges
      .filter((edge) => visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId))
      .sort((left, right) => (
        Number(modeOverlay.connectedEdgeIds.includes(right.id)) - Number(modeOverlay.connectedEdgeIds.includes(left.id))
        || left.relation.localeCompare(right.relation)
        || left.id.localeCompare(right.id)
      ))
      .slice(0, compact ? 36 : 760);

    const groups = new Map<number, GraphInspectorNode[]>();
    for (const node of prioritized) {
      let ring = kindRing(node.kind);
      if (modeActive) {
        if (memberIds.has(node.id)) ring = 0;
        else if (connectedIds.has(node.id)) ring = 1;
        else ring = Math.max(3, ring);
      } else {
        const degree = degreeByNode.get(node.id) ?? 0;
        if (degree >= 8) ring = Math.min(ring, 0);
        else if (degree >= 4) ring = Math.min(ring, 1);
      }
      const group = groups.get(ring) ?? [];
      group.push(node);
      groups.set(ring, group);
    }

    const positioned = new Map<string, PositionedNode>();
    if (layoutMode === 'lineage' && !compact) {
      const levelByKind = new Map<string, number>([
        ['user', 0],
        ['objective', 0],
        ['concept', 1],
        ['topic', 1],
        ['creator', 2],
      ]);
      const levelGroups = new Map<number, GraphInspectorNode[]>();
      const contentNodes = prioritized.filter((node) => node.kind === 'content');
      for (const node of prioritized) {
        if (node.kind === 'content') continue;
        const level = levelByKind.get(node.kind) ?? 2;
        const group = levelGroups.get(level) ?? [];
        group.push(node);
        levelGroups.set(level, group);
      }
      const yByLevel = [72, 190, 330];
      for (const [level, group] of levelGroups.entries()) {
        const sorted = [...group].sort((left, right) => (
          Number(memberIds.has(right.id)) - Number(memberIds.has(left.id))
          || (degreeByNode.get(right.id) ?? 0) - (degreeByNode.get(left.id) ?? 0)
          || left.label.localeCompare(right.label)
          || left.id.localeCompare(right.id)
        ));
        const maxPerRow = level === 2 ? 6 : level === 1 ? 8 : 10;
        const rowCount = Math.max(1, Math.ceil(sorted.length / maxPerRow));
        sorted.forEach((node, index) => {
          const row = Math.floor(index / maxPerRow);
          const rowStart = row * maxPerRow;
          const rowSize = Math.min(maxPerRow, sorted.length - rowStart);
          const indexInRow = index - rowStart;
          const spacing = WIDTH / (rowSize + 1);
          const rowOffset = level === 2 ? row * 88 : row * 54;
          const searchMatch = Boolean(normalizedQuery) && (
            node.label.toLowerCase().includes(normalizedQuery)
            || node.id.toLowerCase().includes(normalizedQuery)
            || node.kind.toLowerCase().includes(normalizedQuery)
          );
          positioned.set(node.id, {
            ...node,
            x: spacing * (indexInRow + 1),
            y: yByLevel[Math.min(level, yByLevel.length - 1)] + rowOffset - ((rowCount - 1) * 10),
            degree: degreeByNode.get(node.id) ?? 0,
            modeMember: memberIds.has(node.id),
            modeConnected: connectedIds.has(node.id),
            searchMatch,
          });
        });
      }

      const createdByParent = new Map<string, string>();
      for (const edge of visibleEdges) {
        if (edge.relation === 'created_by') createdByParent.set(edge.sourceNodeId, edge.targetNodeId);
      }
      const childrenByCreator = new Map<string, GraphInspectorNode[]>();
      for (const content of contentNodes) {
        const parentId = createdByParent.get(content.id);
        if (!parentId) continue;
        const siblings = childrenByCreator.get(parentId) ?? [];
        siblings.push(content);
        childrenByCreator.set(parentId, siblings);
      }
      for (const [creatorId, children] of childrenByCreator.entries()) {
        const parent = positioned.get(creatorId);
        if (!parent) continue;
        const sorted = [...children].sort((left, right) => (
          right.supportCount - left.supportCount
          || left.label.localeCompare(right.label)
          || left.id.localeCompare(right.id)
        ));
        const offsets = sorted.length === 1
          ? [0]
          : sorted.length === 2
            ? [-54, 54]
            : [-68, 0, 68];
        sorted.slice(0, 3).forEach((node, index) => {
          const searchMatch = Boolean(normalizedQuery) && (
            node.label.toLowerCase().includes(normalizedQuery)
            || node.id.toLowerCase().includes(normalizedQuery)
            || node.kind.toLowerCase().includes(normalizedQuery)
          );
          positioned.set(node.id, {
            ...node,
            x: Math.max(42, Math.min(WIDTH - 42, parent.x + (offsets[index] ?? 0))),
            y: Math.min(HEIGHT - 52, parent.y + 92),
            degree: degreeByNode.get(node.id) ?? 0,
            modeMember: memberIds.has(node.id),
            modeConnected: connectedIds.has(node.id),
            searchMatch,
          });
        });
      }
    } else {
      for (const [ring, group] of groups.entries()) {
        const sorted = [...group].sort((left, right) => (
          left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
        ));
        const baseRadius = compact
          ? [24, 82, 132, 178][Math.min(ring, 3)]
          : [42, 126, 220, 314][Math.min(ring, 3)];
        sorted.forEach((node, index) => {
          const count = Math.max(1, sorted.length);
          const phase = (hashString(`${ring}:${count}`) % 1000) / 1000 * Math.PI * 2;
          const angle = phase + (Math.PI * 2 * index) / count;
          const jitter = ((hashString(node.id) % 41) - 20) * (compact ? 0.45 : 1);
          const radius = Math.max(12, baseRadius + jitter);
          const searchMatch = Boolean(normalizedQuery) && (
            node.label.toLowerCase().includes(normalizedQuery)
            || node.id.toLowerCase().includes(normalizedQuery)
            || node.kind.toLowerCase().includes(normalizedQuery)
          );
          positioned.set(node.id, {
            ...node,
            x: CENTER_X + Math.cos(angle) * radius,
            y: CENTER_Y + Math.sin(angle) * radius,
            degree: degreeByNode.get(node.id) ?? 0,
            modeMember: memberIds.has(node.id),
            modeConnected: connectedIds.has(node.id),
            searchMatch,
          });
        });
      }
    }

    return {
      nodes: [...positioned.values()],
      edges: visibleEdges,
      nodeById: positioned,
      modeActive,
      focusIsActive,
      hiddenIsolatedCreatorCount,
    };
  }, [compact, edges, focusOnly, layoutMode, modeOverlay, nodes, searchQuery, selectedEdgeId, selectedNodeId]);

  React.useEffect(() => {
    if (!selectedNodeId) return;
    const node = layout.nodeById.get(selectedNodeId);
    if (!node) return;
    setPan({
      x: CENTER_X - node.x * zoom,
      y: CENTER_Y - node.y * zoom,
    });
  }, [layout.nodeById, selectedNodeId, zoom]);

  const resetView = () => {
    setZoom(compact ? 1.25 : 1);
    setPan({ x: 0, y: 0 });
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (compact) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({
      x: drag.panX + event.clientX - drag.x,
      y: drag.panY + event.clientY - drag.y,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (compact) return;
    event.preventDefault();

    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const pointerX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const pointerY = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    const nextZoom = Math.max(0.45, Math.min(3.5, zoom * factor));
    if (nextZoom === zoom) return;

    const graphX = (pointerX - pan.x) / zoom;
    const graphY = (pointerY - pan.y) / zoom;
    setPan({
      x: pointerX - graphX * nextZoom,
      y: pointerY - graphY * nextZoom,
    });
    setZoom(nextZoom);
  };

  return (
    <div style={{
      position: 'relative',
      overflow: 'hidden',
      border: '1px solid #263244',
      borderRadius: compact ? 10 : 14,
      background: 'radial-gradient(circle at center, #111827 0%, #0b0f16 62%, #080b10 100%)',
      minHeight: height,
    }}>
      {!compact ? (
        <div style={{
          position: 'absolute',
          zIndex: 2,
          top: 10,
          right: 10,
          display: 'flex',
          gap: 6,
        }}>
          <button type="button" onClick={() => setZoom((value) => Math.min(3.5, value * 1.18))}>+</button>
          <button type="button" onClick={() => setZoom((value) => Math.max(0.45, value / 1.18))}>−</button>
          <button type="button" onClick={resetView}>Reset</button>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={compact ? 'Why this graph' : 'Interactive Personal Algorithm Graph'}
        style={{ display: 'block', width: '100%', height, touchAction: 'none', cursor: compact ? 'default' : 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
        onWheel={handleWheel}
      >
        <defs>
          <marker id="myalgo-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L8,3 z" fill="#64748b" />
          </marker>
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {layout.edges.map((edge) => {
            const source = layout.nodeById.get(edge.sourceNodeId);
            const target = layout.nodeById.get(edge.targetNodeId);
            if (!source || !target) return null;
            const selected = edge.id === selectedEdgeId;
            const modeEdge = modeOverlay.connectedEdgeIds.includes(edge.id);
            const dimmed = layout.modeActive && !modeEdge;
            return (
              <g key={edge.id}>
                {!compact && onEdgeSelect ? (
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="transparent"
                    strokeWidth="12"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdgeSelect(edge.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                ) : null}
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={selected ? '#facc15' : modeEdge ? '#38bdf8' : '#475569'}
                  strokeWidth={selected ? 3.6 : modeEdge ? 2.4 : 1.1}
                  strokeOpacity={dimmed ? 0.12 : selected ? 1 : modeEdge ? 0.85 : 0.42}
                  markerEnd="url(#myalgo-arrow)"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdgeSelect?.(edge.id);
                  }}
                  style={{ cursor: onEdgeSelect ? 'pointer' : 'default' }}
                >
                  <title>{source.label} → {target.label} · {edge.relation}</title>
                </line>
                {!compact && (selected || modeEdge) ? (
                  <text
                    x={(source.x + target.x) / 2}
                    y={(source.y + target.y) / 2 - 5}
                    textAnchor="middle"
                    fontSize="10"
                    fill={selected ? '#fde68a' : '#94a3b8'}
                    pointerEvents="none"
                  >
                    {edge.relation}
                  </text>
                ) : null}
              </g>
            );
          })}
          {layout.nodes.map((node) => {
            const selected = node.id === selectedNodeId;
            const dimmed = layout.modeActive && !node.modeConnected && !node.modeMember;
            const radius = compact
              ? selected || node.modeMember ? 7 : 4.5
              : Math.min(18, 5 + Math.sqrt(Math.max(1, node.degree + node.supportCount)) * 2.2);
            const showLabel = !compact && (
              selected
              || node.modeMember
              || node.searchMatch
              || (layoutMode === 'lineage' && node.kind !== 'content')
            );
            return (
              <g
                key={node.id}
                transform={`translate(${node.x} ${node.y})`}
                role={onNodeSelect ? 'button' : undefined}
                tabIndex={onNodeSelect ? 0 : undefined}
                aria-label={onNodeSelect ? `Inspect ${node.label}` : undefined}
                onPointerDown={(event) => {
                  if (!onNodeSelect) return;
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onNodeSelect?.(node.id);
                }}
                onKeyDown={(event) => {
                  if (!onNodeSelect || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onNodeSelect(node.id);
                }}
                style={{ cursor: onNodeSelect ? 'pointer' : 'default', outline: 'none' }}
              >
                {onNodeSelect ? (
                  <rect
                    x={layoutMode === 'lineage' && node.kind === 'content' && node.thumbnailUrl ? -36 : -(radius + 9)}
                    y={layoutMode === 'lineage' && node.kind === 'content' && node.thumbnailUrl ? -23 : -(radius + 9)}
                    width={layoutMode === 'lineage' && node.kind === 'content' && node.thumbnailUrl ? 72 : (radius + 9) * 2}
                    height={layoutMode === 'lineage' && node.kind === 'content' && node.thumbnailUrl ? 46 : (radius + 9) * 2}
                    rx="7"
                    fill="transparent"
                    pointerEvents="all"
                  />
                ) : null}
                {(selected || node.searchMatch) ? (
                  <circle
                    r={radius + 7}
                    fill="none"
                    stroke={selected ? '#facc15' : '#f8fafc'}
                    strokeWidth="2"
                    strokeOpacity="0.8"
                  />
                ) : null}
                {layoutMode === 'lineage' && node.kind === 'content' && node.thumbnailUrl ? (
                  <>
                    <rect
                      x="-30"
                      y="-17"
                      width="60"
                      height="34"
                      rx="5"
                      fill="#111827"
                      stroke={selected ? '#facc15' : node.provenance === 'explicit' ? '#f8fafc' : '#334155'}
                      strokeWidth={selected ? 2.5 : 1.4}
                    />
                    <image
                      href={node.thumbnailUrl}
                      x="-28"
                      y="-15"
                      width="56"
                      height="30"
                      preserveAspectRatio="xMidYMid slice"
                      opacity={dimmed ? 0.25 : 0.92}
                      pointerEvents="none"
                    >
                      <title>{node.label} · content · {node.provenance}</title>
                    </image>
                  </>
                ) : (
                  <circle
                    r={radius}
                    fill={nodeFill(node.kind, selected, node.modeMember)}
                    fillOpacity={dimmed ? 0.18 : node.modeConnected || node.modeMember || !layout.modeActive ? 0.95 : 0.55}
                    stroke={node.provenance === 'explicit' ? '#f8fafc' : '#0f172a'}
                    strokeWidth={node.provenance === 'explicit' ? 1.8 : 1}
                  >
                    <title>{node.label} · {node.kind} · {node.provenance}</title>
                  </circle>
                )}
                {showLabel ? (
                  <text
                    x={layoutMode === 'lineage' && node.kind === 'content' && node.thumbnailUrl ? 35 : radius + 5}
                    y="4"
                    fontSize={selected ? '13' : '11'}
                    fontWeight={selected ? '700' : '500'}
                    fill={dimmed ? '#64748b' : '#e2e8f0'}
                    pointerEvents="none"
                  >
                    {node.label.length > 34 ? `${node.label.slice(0, 31)}…` : node.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      {!compact ? (
        <>
          <div style={{
            position: 'absolute',
            left: 12,
            bottom: 10,
            padding: '6px 8px',
            borderRadius: 8,
            background: 'rgba(15,23,42,.82)',
            color: '#cbd5e1',
            fontSize: 11,
          }}>
            {layout.nodes.length}/{nodes.length} nodes · {layout.edges.length}/{edges.length} edges rendered
            {modeOverlay.modeId !== 'all' ? ` · ${modeOverlay.modeLabel} r${modeOverlay.modeRevision ?? '—'}` : ''}
          </div>
          <div style={{
            position: 'absolute',
            left: 12,
            top: 10,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            maxWidth: '70%',
            padding: '6px 8px',
            borderRadius: 8,
            background: 'rgba(15,23,42,.82)',
            color: '#cbd5e1',
            fontSize: 10,
          }}>
            {[
              ['#60a5fa', 'content'],
              ['#fbbf24', 'creator'],
              ['#a78bfa', 'concept'],
              ['#22d3ee', 'topic'],
              ['#34d399', 'objective'],
            ].map(([color, label]) => (
              <span key={label} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                {label}
              </span>
            ))}
            <span>white ring = explicit · filled dark ring = inferred</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
