/** Waits for `p` at most `ms`: true if it ended in time, false if not (it may still end later). */
export function within(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    p.then(
      () => {
        clearTimeout(t);
        resolve(true);
      },
      () => {
        clearTimeout(t);
        resolve(true);
      },
    );
  });
}
