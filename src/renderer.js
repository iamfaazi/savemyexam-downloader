// Function to initialize the download path
async function initializeDownloadPath() {
    try {
        let savedDownloadPath = localStorage.getItem('downloadPath');

        if (!savedDownloadPath) {
            const homeDir = window.electronAPI.os.homedir();
            savedDownloadPath = window.electronAPI.path.join(homeDir, 'Downloads');
            localStorage.setItem('downloadPath', savedDownloadPath)
        }

        document.getElementById('download-path').innerText = `${savedDownloadPath}`;
        window.electronAPI.send('download-path-onchange', savedDownloadPath);
    } catch (error) {
        console.error('Failed to initialize download path:', error);
        document.getElementById('output').innerText = 'Error: Could not initialize download path.';
    }
}

// Function to open the directory dialog and select download folder
async function chooseDownloadLocation() {
    try {
        const result = await window.electronAPI.invoke('dialog:openDirectory');
        if (result.length > 0) {
            const selectedPath = result[0];
            document.getElementById('download-path').innerText = `${selectedPath}`;
            console.log(`Selected download location: ${selectedPath}`);
            // Save the selected path in settings
            localStorage.setItem('downloadPath', selectedPath);
        } else {
            document.getElementById('output').innerText = 'No directory selected.';
            console.log('No directory selected');
        }
    } catch (error) {
        console.error('Failed to choose directory:', error);
        document.getElementById('output').innerText = 'Error: Could not choose download folder.';
    }
}

// Validate URLs
function validateUrls(urls) {
    const urlArray = urls.split(/\s+/); // Split URLs by whitespace
    const urlPattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
    return urlArray.every(url => urlPattern.test(url)); // Test all URLs
}

// Handle download initiation
document.getElementById('startDownload').addEventListener('click', async () => {
    document.getElementById('output').innerText = '';  // Clear the output on each action

    const data =  Alpine.store('subjectData').items.map(item =>({resourceUrl: item.resourceUrl, subjectName: `${item.subjectTitle} ${item.subjectLevel}`}))

    //document.getElementById('downloadUrls').value.trim();
    // console.log(downloadUrls)
    // if (!urls) {
    //     document.getElementById('output').innerText = 'Please enter URLs.';
    //     return;
    // }
    //
    // if (!validateUrls(urls)) {
    //     document.getElementById('output').innerText = 'Invalid URLs. Please enter valid download links.';
    //     return;
    // }

    try {
        const downloadPath = localStorage.getItem('downloadPath');
        document.getElementById('output').innerHTML = '<i class="fa-solid fa-rocket fa-beat-fade"></i> Initialize download process... \n';
        window.electronAPI.send('start-download', {data, downloadPath});
    } catch (error) {
        console.error('Failed to initiate download:', error);
        document.getElementById('output').innerText = 'Error: Could not start download.';
    }
});

// Trigger folder selection on button click
document.getElementById('choose-directory-button').addEventListener('click', chooseDownloadLocation);

// Listen for logs from the main process
window.electronAPI.on('log', (event, message) => {
    const outputElement = document.getElementById('output');
    // Append logs using insertAdjacentHTML instead of appending#
    outputElement.insertAdjacentHTML('beforeend', `<p class="log">${message}</p>`);
    // outputElement.innerText += message + '\n';  // Append logs instead of overwriting
    // outputElement.scrollTop = outputElement.scrollHeight;  // Auto scroll to the bottom

    // Check if user scrolled to the bottom
    // const isAtBottom = outputElement.scrollHeight - outputElement.clientHeight <= outputElement.scrollTop + 1;

    // Auto scroll to the bottom if enabled and user is at the bottom
    // if (isAtBottom) {
    //     outputElement.scrollTop = outputElement.scrollHeight; // Smooth scroll is handled by CSS
    // }

    // Use setTimeout to ensure the DOM updates before scrolling
    setTimeout(() => {
        outputElement.scrollTop = outputElement.scrollHeight;
    }, 0);
});


window.electronAPI.on('loading', (event, state) => {
    Alpine.store('subjectData').loading = state;  // Set loading to true
});

// Initialize the download path on page-load
initializeDownloadPath().then(r => console.log(r));


document.querySelector('.author').addEventListener('click', () => {
    window.electronAPI.send('open-author-info');
});

document.getElementById('backBtn').addEventListener('click', () => {
    // Redirect to another page
    window.location.href = 'index.html';
});


document.addEventListener('alpine:init', () => {
    const items = () => {
        try {
            const storedSubjects = localStorage.getItem('selectedItems');
            return storedSubjects ? JSON.parse(storedSubjects) : [];
        } catch (e) {
            return []
        }
    };

    // Define the Alpine store
    Alpine.store('subjectData', {
        items: items(),  // Initially empty array
        loading: false, // Loading state

        // Computed property to check if any row is selected
        get hasSelectedItems() {
            return this.items.some(item => item.checked);  // Returns true if any item is selected
        },

        // Computed property to check if items array is empty
        get isEmpty() {
            return !this.items.length;
        },
    });
});
