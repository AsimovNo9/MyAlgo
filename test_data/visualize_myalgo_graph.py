#!/usr/bin/env python3
"""
visualize_myalgo_graph.py

Turns a MyAlgo `myalgo-personal-algorithm-state.json` export into a
self-contained, interactive HTML graph you can open in any browser.

Usage:
    python3 visualize_myalgo_graph.py path/to/state.json [-o out.html]

No pip installs required — only the Python standard library. The
generated HTML pulls the vis-network rendering library from a CDN,
so you need internet access when you *open* the HTML file (not when
you run this script).

What it does:
  - Reads graph.nodes and graph.edges from the export.
  - Colors nodes by `kind` (content, creator, interest, preference, ...)
    so it still works once your graph has more node kinds than it does today.
  - Sizes nodes by degree (how many edges touch them) so hub
    creators/topics stand out.
  - Puts each node's label + kind + provenance + confidence in the
    hover tooltip.
  - Labels edges with their `relation` (e.g. created_by).
  - Drops fully isolated nodes by default (nodes with no edges) since
    they just clutter the view — pass --include-isolated to keep them.
  - Prints a quick summary to the terminal (node/edge counts by kind).
"""

import argparse
import collections
import html
import json
import sys
from pathlib import Path

# Stable-ish palette; extra kinds beyond this list get an auto-generated color.
KIND_COLORS = {
    "content": "#4C9AFF",
    "creator": "#FF8B00",
    "interest": "#36B37E",
    "concept": "#00B8D9",
    "entity": "#6554C0",
    "format": "#FFC400",
    "preference": "#FF5630",
}

FALLBACK_COLORS = [
    "#8993A4", "#998DD9", "#79E2F2", "#57D9A3", "#FF7452", "#B3D4FF",
]


def color_for_kind(kind, palette_cache):
    if kind in KIND_COLORS:
        return KIND_COLORS[kind]
    if kind not in palette_cache:
        palette_cache[kind] = FALLBACK_COLORS[len(palette_cache) % len(FALLBACK_COLORS)]
    return palette_cache[kind]


def truncate(s, n=70):
    if not s:
        return ""
    s = str(s)
    return s if len(s) <= n else s[: n - 1] + "…"


def build(data, include_isolated):
    graph = data.get("graph", {})
    raw_nodes = graph.get("nodes", [])
    raw_edges = graph.get("edges", [])

    degree = collections.Counter()
    for e in raw_edges:
        degree[e["sourceNodeId"]] += 1
        degree[e["targetNodeId"]] += 1

    palette_cache = {}
    kind_counts = collections.Counter()
    vis_nodes = []
    kept_ids = set()

    for n in raw_nodes:
        d = degree.get(n["id"], 0)
        if d == 0 and not include_isolated:
            continue
        kept_ids.add(n["id"])
        kind = n.get("kind", "unknown")
        kind_counts[kind] += 1
        label = truncate(n.get("label", n["id"]), 40)
        tooltip_lines = [
            f"<b>{html.escape(str(n.get('label', n['id'])))}</b>",
            f"kind: {html.escape(kind)}",
            f"provenance: {html.escape(str(n.get('provenance')))}",
        ]
        if n.get("confidence") is not None:
            tooltip_lines.append(f"confidence: {n['confidence']}")
        tooltip_lines.append(f"connections: {d}")
        vis_nodes.append({
            "id": n["id"],
            "label": label,
            "title": "<br>".join(tooltip_lines),
            "color": color_for_kind(kind, palette_cache),
            "value": max(1, d),  # drives node size
            "group": kind,
        })

    vis_edges = []
    for e in raw_edges:
        if e["sourceNodeId"] not in kept_ids or e["targetNodeId"] not in kept_ids:
            continue
        vis_edges.append({
            "from": e["sourceNodeId"],
            "to": e["targetNodeId"],
            "label": e.get("relation", ""),
            "title": f"confidence: {e.get('confidence')}<br>provenance: {html.escape(str(e.get('provenance')))}",
            "arrows": "to",
        })

    legend = [{"kind": k, "color": color_for_kind(k, palette_cache)} for k in sorted(kind_counts)]

    summary = {
        "total_nodes_in_file": len(raw_nodes),
        "total_edges_in_file": len(raw_edges),
        "nodes_shown": len(vis_nodes),
        "edges_shown": len(vis_edges),
        "isolated_nodes_hidden": len(raw_nodes) - len(kept_ids) if not include_isolated else 0,
        "node_kinds": dict(kind_counts),
    }

    return vis_nodes, vis_edges, legend, summary


PAGE_TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>MyAlgo Personal Algorithm Graph</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.2/standalone/umd/vis-network.min.js"></script>
<style>
  html, body {{ margin: 0; height: 100%; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0f1115; color: #e7e9ee; }}
  #header {{ padding: 12px 16px; border-bottom: 1px solid #262a33; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }}
  #header h1 {{ font-size: 15px; margin: 0; font-weight: 600; color: #fff; }}
  #stats {{ font-size: 12px; color: #9aa1ad; }}
  #legend {{ display: flex; gap: 14px; font-size: 12px; flex-wrap: wrap; }}
  .swatch {{ display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }}
  #search {{ margin-left: auto; }}
  #search input {{ background: #1a1d24; border: 1px solid #333743; color: #e7e9ee; border-radius: 6px; padding: 5px 8px; font-size: 12px; width: 200px; }}
  #network {{ width: 100vw; height: calc(100vh - 54px); }}
</style>
</head>
<body>
  <div id="header">
    <h1>MyAlgo Personal Algorithm Graph</h1>
    <div id="stats">{stats_line}</div>
    <div id="legend">{legend_html}</div>
    <div id="search"><input id="searchBox" placeholder="Find a node…"></div>
  </div>
  <div id="network"></div>
<script>
  const nodesData = new vis.DataSet({nodes_json});
  const edgesData = new vis.DataSet({edges_json});

  const container = document.getElementById('network');
  const data = {{ nodes: nodesData, edges: edgesData }};
  const options = {{
    nodes: {{
      shape: 'dot',
      scaling: {{ min: 6, max: 40 }},
      font: {{ color: '#e7e9ee', size: 12, strokeWidth: 0 }},
    }},
    edges: {{
      color: {{ color: '#3a3f4b', highlight: '#e7e9ee' }},
      font: {{ color: '#9aa1ad', size: 9, strokeWidth: 0, align: 'middle' }},
      smooth: {{ type: 'continuous' }},
      width: 1,
    }},
    physics: {{
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {{ gravitationalConstant: -60, springLength: 90, springConstant: 0.06 }},
      stabilization: {{ iterations: 150 }},
    }},
    interaction: {{ hover: true, tooltipDelay: 100 }},
  }};
  const network = new vis.Network(container, data, options);

  document.getElementById('searchBox').addEventListener('input', (e) => {{
    const q = e.target.value.trim().toLowerCase();
    if (!q) {{ nodesData.forEach(n => nodesData.update({{ id: n.id, hidden: false }})); return; }}
    nodesData.forEach(n => {{
      const match = (n.label || '').toLowerCase().includes(q);
      nodesData.update({{ id: n.id, hidden: !match }});
    }});
  }});
</script>
</body>
</html>
"""


def render_html(vis_nodes, vis_edges, legend, summary):
    stats_line = (
        f"{summary['nodes_shown']} nodes / {summary['edges_shown']} edges shown "
        f"(of {summary['total_nodes_in_file']} nodes / {summary['total_edges_in_file']} edges in file"
        + (f", {summary['isolated_nodes_hidden']} isolated hidden)" if summary['isolated_nodes_hidden'] else ")")
    )
    legend_html = "".join(
        f'<span><span class="swatch" style="background:{item["color"]}"></span>{html.escape(item["kind"])}</span>'
        for item in legend
    )
    return PAGE_TEMPLATE.format(
        stats_line=html.escape(stats_line),
        legend_html=legend_html,
        nodes_json=json.dumps(vis_nodes),
        edges_json=json.dumps(vis_edges),
    )


def main():
    parser = argparse.ArgumentParser(description="Visualize a MyAlgo graph-state export as an interactive HTML graph.")
    parser.add_argument("input", type=Path, help="Path to myalgo-personal-algorithm-state.json")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output HTML path (default: alongside input, .html)")
    parser.add_argument("--include-isolated", action="store_true", help="Include nodes with zero edges")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"error: {args.input} not found", file=sys.stderr)
        sys.exit(1)

    data = json.loads(args.input.read_text())
    vis_nodes, vis_edges, legend, summary = build(data, args.include_isolated)
    out_path = args.output or args.input.with_suffix(".html")
    out_path.write_text(render_html(vis_nodes, vis_edges, legend, summary))

    print("Graph summary:")
    print(f"  nodes in file:  {summary['total_nodes_in_file']}")
    print(f"  edges in file:  {summary['total_edges_in_file']}")
    print(f"  node kinds:     {summary['node_kinds']}")
    print(f"  nodes shown:    {summary['nodes_shown']}")
    print(f"  edges shown:    {summary['edges_shown']}")
    print(f"\nWrote {out_path} — open it in a browser.")


if __name__ == "__main__":
    main()
