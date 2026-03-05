const Log = require('../models/Log');
const geoip = require('geoip-lite'); // 🌍 1. Import the library

const getTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

const addLog = async (type, message, req = null, details = null) => {
    try {
        let ipAddress = null;
        let location = 'Unknown';
        let userAgent = null;
        let endpoint = null;
        let userId = null;

        if (req) {
            // Get the raw IP
            ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            // 🛑 FYP DEBUGGING TRICK 🛑
            // Localhost IPs (::1 or 127.0.0.1) cannot be geo-located because they aren't on the public internet.
            // For testing your dashboard, we will temporarily force a public Malaysian IP if you are on localhost.
            if (ipAddress === '::1' || ipAddress === '127.0.0.1') {
                ipAddress = '175.143.60.1'; // Example TM Net IP in Malaysia
            }

            // 🌍 2. Translate IP to Location
            const geo = geoip.lookup(ipAddress);
            if (geo) {
                // geo object contains: { country: 'MY', city: 'Kuala Lumpur', ll: [lat, long], etc. }
                location = `${geo.city || 'Unknown City'}, ${geo.country}`;
            }

            userAgent = req.get('User-Agent');
            endpoint = req.originalUrl;
            if (req.user && req.user.id) userId = req.user.id;
        }

        // Save to Database
        const newLog = new Log({
            type: type.toUpperCase(),
            message,
            details,
            ipAddress,
            location, // 🌍 3. Save the translated location
            userAgent,
            endpoint,
            user: userId
        });

        await newLog.save();
        console.log(`[${getTime()}] [${type.toUpperCase()}] ${message} (${location})`);

    } catch (err) {
        console.error("❌ Failed to save log to DB:", err.message);
    }
};

const getLogs = async (limit = 50) => {
    try {
        const logs = await Log.find({}, null, {
            sort: { timestamp: -1 },
            limit: limit
        }).exec();
        return logs;
    } catch (err) {
        console.error("❌ Failed to fetch logs:", err.message);
        return [];
    }
};

module.exports = { addLog, getLogs };