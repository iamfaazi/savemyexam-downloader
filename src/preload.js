const {contextBridge, ipcRenderer} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');


// Expose ipcRenderer methods and Node.js modules safely
contextBridge.exposeInMainWorld('electronAPI', {
    invoke: async (channel, args) => {
        try {
            return await ipcRenderer.invoke(channel, args);
        } catch (error) {
            console.error(`Error invoking ${channel}:`, error);
            throw error;
        }
    },
    send: (channel, args) => ipcRenderer.send(channel, args),
    on: (channel, callback) => {
        const subscription = (event, data) => callback(event, data);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription); // Unsubscribe if necessary
    },
    path: {
        join: (...args) => path.join(...args),
        resolve: (...args) => path.resolve(...args),
    },
    os: {
        homedir: () => os.homedir(),
        platform: () => os.platform(),
        cpus: () => os.cpus(),
    },
    store: {
        set: async (key, value) => {
            const {default: Store} = await import('electron-store');
            const store = new Store();
            store.set(key, value);
        },
        get: async (key) => {
            const {default: Store} = await import('electron-store');
            const store = new Store();
            return store.get(key);
        }
    },
    fs: {
        readFile: (filePath, encoding) => fs.promises.readFile(filePath, encoding),
        writeFile: (filePath, data) => fs.promises.writeFile(filePath, data),
        exists: (filePath) => fs.existsSync(filePath),
    }
});
