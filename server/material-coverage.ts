type Need = { id: string; partId: string; quantity: number };
type Substitute = { originalPartId: string; replacementPartId: string };
// Allocate each physical unit at most once across a task's compatible requirements.
// Residual paths let scarce substitutes be reassigned when another requirement has fewer options.
export function materialCoverage(
  needs: Need[],
  substitutes: Substitute[],
  stock: Map<string, number>,
) {
  const parts = [...stock.keys()].sort(),
    sink = 1 + parts.length + needs.length;
  type Edge = { to: number; reverse: number; remaining: number };
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const add = (from: number, to: number, capacity: number) => {
    const edge: Edge = {
      to,
      reverse: graph[to].length,
      remaining: Math.max(0, capacity),
    };
    graph[from].push(edge);
    graph[to].push({ to: from, reverse: graph[from].length - 1, remaining: 0 });
    return edge;
  };
  parts.forEach((part, i) => add(0, 1 + i, stock.get(part) || 0));
  const demand = needs.map((need, j) =>
    add(1 + parts.length + j, sink, need.quantity),
  );
  const links: {
    partId: string;
    needId: string;
    edge: Edge;
    capacity: number;
  }[] = [];
  const accepted = needs.map(
    (need) =>
      new Set([
        need.partId,
        ...substitutes
          .filter((s) => s.originalPartId === need.partId)
          .map((s) => s.replacementPartId),
      ]),
  );
  parts.forEach((part, i) => {
    // Prefer the catalog part's own demand, while residual paths can still reassign it.
    needs
      .map((need, j) => ({ need, j }))
      .filter(({ j }) => accepted[j].has(part))
      .sort(
        (a, b) =>
          Number(b.need.partId === part) - Number(a.need.partId === part),
      )
      .forEach(({ need, j }) =>
        links.push({
          partId: part,
          needId: need.id,
          edge: add(1 + i, 1 + parts.length + j, need.quantity),
          capacity: need.quantity,
        }),
      );
  });
  for (;;) {
    const previousNode = Array(sink + 1).fill(-1),
      previousEdge = Array(sink + 1).fill(-1),
      queue = [0];
    previousNode[0] = 0;
    for (
      let head = 0;
      head < queue.length && previousNode[sink] === -1;
      head++
    ) {
      const node = queue[head];
      graph[node].forEach((edge, i) => {
        if (edge.remaining > 0 && previousNode[edge.to] === -1) {
          previousNode[edge.to] = node;
          previousEdge[edge.to] = i;
          queue.push(edge.to);
        }
      });
    }
    if (previousNode[sink] === -1) break;
    let amount = Infinity;
    for (let node = sink; node !== 0; node = previousNode[node])
      amount = Math.min(
        amount,
        graph[previousNode[node]][previousEdge[node]].remaining,
      );
    for (let node = sink; node !== 0; node = previousNode[node]) {
      const edge = graph[previousNode[node]][previousEdge[node]];
      edge.remaining -= amount;
      graph[node][edge.reverse].remaining += amount;
    }
  }
  return new Map(
    needs.map((need, j) => [
      need.id,
      {
        coverage: Math.min(
          need.quantity,
          demand[j].remaining <= Number.EPSILON * need.quantity * 8
            ? need.quantity
            : Math.max(0, need.quantity - demand[j].remaining),
        ),
        sources: links
          .filter(
            (l) => l.needId === need.id && l.capacity - l.edge.remaining > 0,
          )
          .map((l) => ({
            partId: l.partId,
            quantity: l.capacity - l.edge.remaining,
          })),
      },
    ]),
  );
}
