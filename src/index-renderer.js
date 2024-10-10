document.querySelector('.author').addEventListener('click', () => {
    window.electronAPI.send('open-author-info');
});

document.getElementById('loginBtn').addEventListener('click', () => {
    window.electronAPI.send('login');
})

window.electronAPI.on('loading', (event, state) => {
    const loginBtnContainer = document.querySelector('.button-container');
    const loginBtn = document.querySelector('#loginBtn');
    const loginBtnIcon = loginBtn.querySelector('.icon');
    const loginBtnLoader = loginBtn.querySelector('.loader');
    const loginBtnLabel = loginBtn.querySelector('.btn-label');

    if (state) {
        loginBtnIcon.classList.toggle('hidden');
        loginBtnLoader.classList.toggle('hidden');
        loginBtnLabel.innerText = 'SignIn...';
    } else {
        loginBtnIcon.classList.toggle('hidden');
        loginBtnLoader.classList.toggle('hidden');
        loginBtnLabel.innerText = 'Login & Browse';

        //Show main container
        // loginBtnContainer.classList.toggle('hidden');
        // document.querySelector('.main-container').classList.toggle('hidden')
    }

    loginBtn.disabled = state;

    // Call updateSelectAllState after initialization
    Alpine.store('subjectData').listLoading = state;  // Set loading to true
});


window.electronAPI.on('set-greeting', (event, message) => {
    if (message) localStorage.setItem('user-greeting', message)
    document.querySelector('#user-greeting').textContent = message;
});

// Listen for updates from the main process
window.electronAPI.on('set-data', (event, subjectData) => {
    console.log(subjectData);
    // Update the store with the new subjects
    Alpine.store('subjectData').loadSubjects(subjectData);

    // setTimeout(updateCheckboxes, 500);
});


document.addEventListener('alpine:init', () => {
    const items = () => {
        try {
            const storedSubjects = localStorage.getItem('subjects');
            return storedSubjects ? JSON.parse(storedSubjects) : [];
        } catch (e) {
            return []
        }
    };

    // Define the Alpine store
    Alpine.store('subjectData', {
        items: items(),  // Initially empty array
        // State for managing select all and indeterminate status
        selectAll: false,
        isIndeterminate: false,
        loading: false, // Loading state
        listLoading: false, // Loading state

        // Computed property to check if any row is selected
        get hasSelectedItems() {
            return this.items.some(item => item.checked);  // Returns true if any item is selected
        },

        // Computed property to check if items array is empty
        get isEmpty() {
            return !this.items.length;
        },

        // Method to load subjects dynamically
        loadSubjects(subjects) {
            // Update the items array with new subjects
            this.items = subjects.map(item => ({
                ...item,
                checked: this.items.some(eItem => eItem.id === item.id && eItem.checked)
            }));

            //Persist to Localstorage
            localStorage.setItem('subjects', JSON.stringify(this.items));
            this.updateSelectAllState();  // Ensure state is updated when items are loaded
        },

        // Method to toggle all child checkboxes
        toggleAll() {
            this.items.forEach(item => item.checked = this.selectAll);
            this.updateSelectAllState();
        },

        // Method to update select all and indeterminate states
        updateSelectAllState() {
            const total = this.items.length;
            const checked = this.items.filter(item => item.checked).length;

            // Set selectAll based on whether all items are selected
            this.selectAll = checked === total;

            // Set indeterminate state based on partial selection
            this.isIndeterminate = checked > 0 && checked < total;

            // If $refs is defined and parentCheckbox exists
            if (this.$refs?.parentCheckbox) {
                this.$refs.parentCheckbox.indeterminate = this.isIndeterminate;
            }
            //
            localStorage.setItem('subjects', JSON.stringify(this.items));
        },

        // Method to get selected items and trigger download
        async downloadSelected() {
            this.loading = true; // Set loading to true

            const selectedItems = this.items.filter(item => item.checked);

            //Persist to Localstorage
            localStorage.setItem('selectedItems', JSON.stringify(selectedItems));

            if (selectedItems.length > 0) {
                console.log('Selected items:', selectedItems);
                // Your download logic here, using the selectedItems array
                // Simulate download logic with a timeout
                await new Promise(resolve => setTimeout(resolve, 500)); // Simulating a download delay
                // Redirect to another page
                window.location.href = 'homepage.html';
            } else {
                alert('No items selected!');
                // this.loading = false; // Reset loading to false
            }
        },

        updateList() {
            window.electronAPI.send('login');
        }
    });

    // Call updateSelectAllState after initialization
    Alpine.store('subjectData').updateSelectAllState();

    if (!Alpine.store('subjectData').isEmpty) {
        document.querySelector('#user-greeting').textContent = localStorage.getItem('user-greeting');
    }
});