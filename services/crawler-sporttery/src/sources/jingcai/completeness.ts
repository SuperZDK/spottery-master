export function isSettled(m: any): boolean {
  const mr = m?.matchResult;
  return typeof mr === "string" && mr.trim() !== "";
}

export function isRefund(m: any): boolean {
  return m?.poolStatus === "Refund";
}

export function isMatchIncomplete(m: any): boolean {
  return !isSettled(m);
}

export function isDetailIncomplete(detail: any): boolean {
  return (
    detail === null || detail === undefined ||
    detail.matchInfo === undefined || detail.matchInfo === null ||
    detail.oddsHistory === undefined || detail.oddsHistory === null
  );
}
