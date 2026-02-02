// utils/logger.js
let eventLogs = [];

// Helper to format time like [10:45:02]
const getTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

const addLog = (type, message, details = null) => {
    const logEntry = {
        id: Date.now() + Math.random(),
        timestamp: getTime(),
        type: type.toUpperCase(), // e.g., UPLOAD, ERROR, SECURITY
        message,
        details
    };

    // Add to the top of the list
    eventLogs.unshift(logEntry);

    // Keep memory clean: Only store last 50 logs
    if (eventLogs.length > 50) eventLogs.pop();

    // ALSO print to VS Code Terminal (for debugging)
    console.log(`[${logEntry.timestamp}] [${logEntry.type}] ${message}`);
};

const getLogs = () => eventLogs;

module.exports = { addLog, getLogs };