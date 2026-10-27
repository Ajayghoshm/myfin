const addLog = (logMessage: string, forceDisplay = false) => {
  const logsAreEnabled = process.env.LOGGING === 'true';
  // eslint-disable-next-line no-console
  if (logsAreEnabled || forceDisplay) {
    console.log(logMessage);
  }
};

const addStringifiedLog = (logMessage: any, forceDisplay = false) => {
  addLog(JSON.stringify(logMessage), forceDisplay);
};

/**
 * Logs an error without its payload: joi's ValidationError carries `_original` (the whole request
 * body, passwords included), so only the name and message are printed.
 */
const addErrorLog = (err: unknown, forceDisplay = false) => {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  addLog(msg, forceDisplay);
};

// eslint-disable-next-line import/prefer-default-export
export default { addLog, addStringifiedLog, addErrorLog };
