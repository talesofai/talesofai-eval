export type ProgressBoard = {
  readonly isLive: boolean;
  startRow(key: string, index: number, row: string): void;
  updateRows(updates: Array<{ key: string; row: string }>): void;
  finishRow(key: string, row: string): void;
  setFooter(footer: string): void;
  clearFooter(): void;
};

export function createProgressBoard(options: {
  enabled: boolean;
}): ProgressBoard {
  const isLive = options.enabled && process.stderr.isTTY === true;
  const rows: string[] = [];
  const rowIndexByKey = new Map<string, number>();
  let footer = "";
  let renderedLineCount = 0;

  const redrawRows = (): void => {
    if (!isLive) {
      return;
    }

    if (renderedLineCount > 0) {
      process.stderr.write(`\u001B[${renderedLineCount}A`);
    }

    for (const row of rows) {
      process.stderr.write("\u001B[2K");
      process.stderr.write(`${row ?? ""}\n`);
    }

    if (footer.length > 0) {
      process.stderr.write("\u001B[2K");
      process.stderr.write(`${footer}\n`);
    }

    renderedLineCount = rows.length + (footer.length > 0 ? 1 : 0);
  };

  return {
    isLive,

    startRow(key: string, index: number, row: string): void {
      rowIndexByKey.set(key, index);
      if (isLive) {
        rows[index] = row;
        redrawRows();
        return;
      }
      process.stderr.write(`${row}\n`);
    },

    updateRows(updates: Array<{ key: string; row: string }>): void {
      if (!isLive || updates.length === 0) {
        return;
      }

      for (const update of updates) {
        const index = rowIndexByKey.get(update.key);
        if (index !== undefined) {
          rows[index] = update.row;
        }
      }

      redrawRows();
    },

    finishRow(key: string, row: string): void {
      const index = rowIndexByKey.get(key);
      if (isLive && index !== undefined) {
        rows[index] = row;
        redrawRows();
        return;
      }
      process.stderr.write(`${row}\n`);
    },

    setFooter(nextFooter: string): void {
      if (!isLive) {
        return;
      }

      footer = nextFooter;
      redrawRows();
    },

    clearFooter(): void {
      if (!isLive) {
        return;
      }

      footer = "";
      redrawRows();
    },
  };
}

export function formatElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatElapsedMs(elapsedMs: number): string {
  return formatElapsedSeconds(elapsedMs / 1000);
}

export function renderCompactProgressBar(done: number, total: number): string {
  const width = 18;
  if (total <= 0) {
    return "░".repeat(width);
  }

  const ratio = Math.min(1, Math.max(0, done / total));
  const filled = Math.round(ratio * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

export type TickerManager = {
  ensure(): void;
  maybeStop(activeCount: number): void;
  clear(): void;
};

export function createTickerManager(options: {
  intervalMs: number;
  isLive: boolean;
  onTick: () => void;
}): TickerManager {
  let ticker: ReturnType<typeof setInterval> | null = null;

  const ensure = (): void => {
    if (!options.isLive || options.intervalMs <= 0 || ticker !== null) {
      return;
    }

    ticker = setInterval(() => {
      options.onTick();
    }, options.intervalMs);
  };

  const maybeStop = (activeCount: number): void => {
    if (activeCount === 0) {
      if (ticker) {
        clearInterval(ticker);
        ticker = null;
      }
    }
  };

  const clear = (): void => {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };

  return { ensure, maybeStop, clear };
}
