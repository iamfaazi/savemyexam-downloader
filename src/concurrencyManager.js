const os = require('os');
const NetworkSpeed = require('network-speed'); // for basic speed measurement

const testNetworkSpeed = new NetworkSpeed();

// Basic system resource information
const getCpuUsage = () => os.loadavg()[0]; // 1-minute CPU load average
const getFreeMemoryPercentage = () => os.freemem() / os.totalmem();

// Network speed check using network-speed
const getNetworkSpeed = async () => {
    const baseUrl = 'http://ipv4.download.thinkbroadband.com/10MB.zip'; // Replace with your test file URL
    const fileSizeInBytes = 10000000; // Ensure this is a valid number

    // Validate file size
    if (isNaN(fileSizeInBytes)) {
        throw new Error('Invalid file size, must be a number.');
    }

    // Check download speed
    const speed = await testNetworkSpeed.checkDownloadSpeed(baseUrl, fileSizeInBytes);
    return speed;
};

// Adjust limits based on system load and network conditions
const adjustConcurrencyLimits = async () => {
    const cpuUsage = getCpuUsage();
    const freeMemory = getFreeMemoryPercentage();
    const downloadSpeed = await getNetworkSpeed(); // downloadSpeed in bits/sec

    let sectionLimit = parseInt(process.env.CONCURRENT_SECTIONS_LIMIT) || 1; // default
    let downloadLimit = parseInt(process.env.CONCURRENT_DOWNLOAD_LIMIT) || 5; // default

    // Adjust section concurrency based on CPU and memory
    if (cpuUsage < 1 && freeMemory > 0.5) {
        sectionLimit = Math.min(4, os.cpus().length); // up to number of CPU cores
    } else if (cpuUsage > 2 || freeMemory < 0.2) {
        sectionLimit = 2; // Reduce if high CPU usage or low memory
    }

    // Adjust download concurrency based on network speed
    if (downloadSpeed && downloadSpeed.mbps > 10000) { // more than 1MB/sec
        downloadLimit = 10; // allow more concurrent downloads
    } else if (downloadSpeed && downloadSpeed < 5000) { // less than 50KB/sec
        downloadLimit = 2; // reduce concurrent downloads on slow network
    }

    return { sectionLimit, downloadLimit };
};

module.exports = {
    adjustConcurrencyLimits,
};
