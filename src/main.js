const {app, BrowserWindow, ipcMain, dialog, Menu} = require('electron');
const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Load environment variables
dotenv.config();

let mainWindow;

// Set up logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

let failList = [];
let browserInstances = []; // Track active browser instances

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 680,
        webPreferences: {
            devTools: false,
            preload: path.join(__dirname, './preload.js'),   // Make sure this points to preload.js in the src directory
            nodeIntegration: false,                      // Keep nodeIntegration disabled for security
            contextIsolation: true,                      // Isolate preload.js context from renderer
            enableRemoteModule: false,                    // Remote module is deprecated,
            sandbox: false, // add this,
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Handle download location selection
    ipcMain.handle('dialog:openDirectory', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });
        return result.filePaths; // Return the selected directory paths
    });

    // Set the window to always be on top
    // mainWindow.setAlwaysOnTop(true);
    mainWindow.focus();


    // Check if consent has already been shown
    const data = loadData();
    if (!data.cookieConsentShown) {
        showCookieConsentDialog(mainWindow);
    }

    mainWindow.on('close', (event) => {
        event.preventDefault(); // Prevent window from closing immediately

        const choice = dialog.showMessageBoxSync(mainWindow, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: 'Are you sure you want to quit?',
            defaultId: 1, // Default to 'No'
            cancelId: 1   // Treat 'No' as cancel action
        });

        if (choice === 0) { // 'Yes' button is clicked
            mainWindow.destroy(); // Close the window
        }
    });

    // Check for updates when the app is ready
    // autoUpdater.checkForUpdatesAndNotify().then(r => {});

}


// Auto-update events
autoUpdater.on('update-available', async (info) => {
    log.info('Update available:', info);
    await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available. It will be downloaded in the background.`,
    });
});

autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'A new version has been downloaded. Restart the application to apply the update.',
        buttons: ['Restart', 'Later']
    }).then((result) => {
        if (result.response === 0) { // 'Restart' button clicked
            autoUpdater.quitAndInstall(); // Install the update and restart
        }
    });
});

autoUpdater.on('error', async (error) => {
    log.error('Update error:', error);
    await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Error',
        message: `Error occurred during update: ${error.message}`
    });
});


// Define the path to the data file
const dataFilePath = path.join(app.getPath('userData'), 'data.json'); // Use userData for better organization

// Function to save data
function saveData(data) {
    fs.writeFileSync(dataFilePath, JSON.stringify(data), 'utf8');
}

// Function to load data
function loadData() {
    if (fs.existsSync(dataFilePath)) {
        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    }
    return {};
}

/**
 *
 * @param win
 */
function showCookieConsentDialog(win) {
    const options = {
        type: 'info',
        defaultId: 0,
        title: 'Author Message',
        message: 'This application is dedicated to my princess daughter, Mirza Haris, my everything, with endless love and gratitude.',
        detail: `"Dream big, little one, for the future is bright, and the world is yours to explore."`,
        buttons: ['OK!'],
    };

    dialog.showMessageBox(win, options).then((response) => {
        if (response.response === 0) {
            console.log('User accepted cookies');
            // Mark consent as shown
            const data = loadData();
            if (!data.cookieConsentShown) {
                // Show dialog
                // After showing, save the consent status
                data.cookieConsentShown = true;
                saveData(data);
            }

        } else {
            console.log('User declined cookies');
        }
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});


app.on('browser-window-created', (e, window) => {
    window.webContents.on('before-input-event', (event, input) => {
        // Disable opening devtools with keyboard shortcuts
        if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
            event.preventDefault();
        }
    });
});

app.on('ready', () => {
    const menu = Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                {role: 'quit'} // Only include essential options
            ]
        },
        {
            label: 'Update',
            click:()=> {
                dialog.showMessageBoxSync({
                    type: 'info',
                    title: 'App Update',
                    message: 'Coming soon!',
                    buttons: ['OK']
                });
            }
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About Us',
                    click: () => {
                        dialog.showMessageBoxSync({
                            type: 'info',
                            title: 'About Us',
                            message: `This application is dedicated to my princess daughter, Mirza Haris, my everything, with endless love and gratitude.

         "Dream big, little one, for the future is bright, and the world is yours to explore."`,
                            buttons: ['OK']
                        });
                    }
                }
            ]
        }
    ]);
    Menu.setApplicationMenu(menu);
});

// Graceful Shutdown: Cleanup when app is closing
app.on('before-quit', async (e) => {
    mainWindow.webContents.send('log', 'Application is shutting down. Closing browser instances...');
    await shutdown();
});

process.on('SIGINT', async () => {
    mainWindow.webContents.send('log', 'Received SIGINT. Closing browser instances...');
    await shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    mainWindow.webContents.send('log', 'Received SIGTERM. Closing browser instances...');
    await shutdown();
    process.exit(0);
});

// Function to handle shutdown
async function shutdown() {
    if (browserInstances.length > 0) {
        for (const browser of browserInstances) {
            try {
                await browser.close();
            } catch (error) {
                mainWindow.webContents.send('log', `Error closing browser: ${error.message}`);
            }
        }
    }
}

ipcMain.on('open-author-info', () => showCookieConsentDialog(mainWindow));

// Listen for 'login' event from the renderer process
ipcMain.on('login', async (event) => {
    event.sender.send('loading', true);

    const browser = await puppeteer.launch({
        headless: true,
    });

    const page = await browser.newPage();

    // Set the window to always be on top
    mainWindow.focus();

    await loginToWebsite(page, event);
    await page.goto('https://www.savemyexams.com/members', {waitUntil: 'networkidle2'});

    const userGreeting$ = await page.waitForSelector('[data-cy="user-greeting"]', {visible: true});
    const userGreeting = await userGreeting$.evaluate(el => el.textContent);
    event.sender.send('set-greeting', userGreeting);


    // Wait for the element using XPath with modern Puppeteer
    const subjectsTable = await page.locator('::-p-xpath(//main//table[contains(@class, "styles_table_")])').waitHandle();

    // Select the element whose id starts with 'collapse-top-'
    const rows = await subjectsTable.$$("tbody > tr");

    const subjects = [];
    for (const row of rows) {
        const subjectTitle = await row.$eval('[class^="styles_subjectName_"]', el => el.innerText.trim());
        const subjectLevel = await row.$eval('td:nth-child(2)', el => el.innerText.trim());
        const resourceUrl = await row.$eval('[class^="styles_rowAction_"]', el => el.href);

        subjects.push({id: `${subjectTitle}${subjectLevel}`, subjectTitle, subjectLevel, resourceUrl})
    }

    event.sender.send('set-data', subjects);

    //Loader set to hidden
    event.sender.send('loading', false);
    await browser.close();
});


// Listen for 'start-download' event from the renderer process
ipcMain.on('start-download', async (event, {data, downloadPath}) => {
    // const downloadUrls = urls.split(',').map(url => url.trim()).filter(url => url);

    if (!data.length) {
        event.sender.send('log', 'No URLs provided.');
        return;
    }

    event.sender.send('loading', true);

    const downloadDir = downloadPath;//path.join(process.cwd(), 'downloads');
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir);
    }

    try {
        const browser = await puppeteer.launch({
            headless: true,
        });
        const page = await browser.newPage();


        // Set the window to always be on top
        mainWindow.focus();

        await loginToWebsite(page, event);

        for (const subject of data) {
            event.sender.send('log', `\nProcessing : ${subject.subjectName}`);

            // Go to target page
            await page.goto(subject.resourceUrl, {waitUntil: 'networkidle2'});

            // Wait for the container div to load
            const sectionContainer = await page.waitForSelector("::-p-xpath(//div[contains(@class, 'collapse') and contains(@class, 'show')])");

            // Find all the `a` tags with "Revision Notes" and get their href attributes
            const targetEl = ['Revision Notes', 'Topic Questions'];

            const revisionNotesLinks = await sectionContainer.evaluate((params) => {
                // const container = params.querySelector('div[class^="level-subject-overview_links__"]');
                // if (container) {
                const links = params.querySelectorAll('a[class^="ResourceLink_link_"]');

                return Array.from(links)
                    .filter(link => {
                        const textElement = link.querySelector('[class^="ResourceLink_text__"]');
                        return textElement && (textElement.innerText.trim() === 'Revision Notes' || textElement.innerText.trim() === 'Exam Questions');
                    })
                    .map(link => ({
                        url: link.href,
                        type: link.querySelector('[class^="ResourceLink_text__"]').innerText.trim()
                    }));
                // }
                // return [];
            });

            if (revisionNotesLinks.length > 0) {
                const mainTitle = await page.$eval('h1[class^="Hero_h1_"]', el => el.innerText.trim().replace(':', '-'));

                // Loop through each link and navigate to the page
                for (const {url, type} of revisionNotesLinks) {

                    //create or use existing downloads location
                    const mainPath = path.join(downloadDir, mainTitle, type);

                    if (type === 'Exam Questions') {
                        // Specify the old and new directory names
                        const oldDir = path.join(downloadDir, mainTitle, 'Topic Questions');
                        const newDir = path.join(downloadDir, mainTitle, type);

                        //Topics Questions
                        if (fs.existsSync(oldDir)) {
                            fs.rename(oldDir, newDir, err => {
                                if (err) {
                                    console.error('Error renaming directory:', err);
                                } else {
                                    console.log('Directory renamed successfully!');
                                }
                            });
                        }
                    }

                    if (!fs.existsSync(mainPath)) {
                        fs.mkdirSync(mainPath, {recursive: true});
                    }

                    try {
                        //Download Revision Notes
                        if (type === 'Revision Notes') {
                            console.log('Revision Notes links found:', url);
                            event.sender.send('log', `<br><br><span class="info"><i class="fa-solid fa-network-wired"></i> Initialize Revision Notes Download</span>`);
                            await downloadRevisionNotes(url, browser, event, mainPath);
                        } else {
                            console.log('Exam Questions links found:', url);
                            event.sender.send('log', `<br><br><span class="info"><i class="fa-regular fa-circle-question"></i> Initialize Exam Questions Download</span>`);
                            await downloadTopicQuestions(url, browser, event, mainPath);
                        }
                    } catch (e) {
                        console.log(e)
                        event.sender.send('log', `<span class="danger">Error during download process</span>`);
                    }
                }
            } else {
                console.log('No Downloads links found.');
            }
        }

        await browser.close();
        event.sender.send('log', `<br> <span class="success"><i class="fa-regular fa-circle-check"></i> All downloads finished!</span>`);
        event.sender.send('loading', false);
    } catch (error) {
        console.log(error)
        event.sender.send('loading', false);
        event.sender.send('log', `<span class="danger">Error during download process</span>`);
    }
});


async function loginToWebsite(page, event) {
    try {
        await page.goto('https://www.savemyexams.com/login/?method=email-password', {waitUntil: 'networkidle2'});
        await page.type('#email-page', process.env.ACCOUNT_EMAIL);
        await page.type('#password-page', process.env.ACCOUNT_PASSWORD);
        await page.click('[data-healthcheck="login-button"]');
        event.sender.send('log', `<i class="fas fa-lock fa-flip"></i> Logging into your account...`);

        try {
            await page.waitForNavigation({waitUntil: 'networkidle2', timeout: 5000});
        } catch {
            console.log('Login timeout, continuing...');
        }
    } catch (error) {
        throw new Error(`Login failed: ${error.message}`);
    }
}

/**
 * @param url
 * @param browser
 * @param event
 * @param downloadDir
 * @return {Promise<void>}
 */
async function downloadRevisionNotes(url, browser, event, downloadDir) {
    console.log(`Navigating to: ${url}`);
    // Open a new page for each link
    const newPage = await browser.newPage();
    await newPage.goto(url, {waitUntil: 'networkidle2'});

    // Do something on the new page, like extracting data, downloading content, etc.
    console.log(`Successfully navigated to ${url}`);

    // Wait for the element using XPath with modern Puppeteer
    const mainContainer = await newPage.locator('::-p-xpath(//main[contains(@class, "container")]/div[contains(@class, "row") and contains(@class, "gy-4")])').waitHandle();

    // Select the element whose id starts with 'collapse-top-'
    const element = await mainContainer.$("div[id^='collapse-top-'].show > div > a.link-body-emphasis");
    const firstTopicUrl = await element.evaluate(el => el.href);

    const page = await browser.newPage();
    await page.goto(firstTopicUrl, {waitUntil: 'networkidle2'});


    //Topic Details Page
    // await page.waitForSelector('nav[class^="revision-notes_nav__"]', {visible: true});
    await page.waitForSelector('[data-cy^="nav-section-"]', {visible: true});

    const mainSections = await page.$$('[data-cy^="nav-section-"]');


    const limitSections = pLimit(parseInt(process.env.CONCURRENT_SECTIONS_LIMIT) || 3);
    const limitDownloads = pLimit(parseInt(process.env.CONCURRENT_DOWNLOAD_LIMIT) || 5);


    for (const section of mainSections) {
        const sectionTitle = await section.$eval('a[class^="CollapseWithLink_link_"]', el => el.innerText.trim().replace(':', '-'));
        const sectionPath = path.join(downloadDir, sectionTitle);

        if (!fs.existsSync(sectionPath)) {
            fs.mkdirSync(sectionPath);
        }

        const subSections = await section.$$('[data-cy^="nav-topic-"]');
        const sectionTasks = subSections.map((subSection) => limitSections(() => navigateToSubSection(subSection, sectionPath, event, page, browser)));

        event.sender.send('log', `<br><span class="success"><i class="fas fa-download fa-bounce loader"></i> Downloading ${sectionTitle} section's topics...</span>`);
        await Promise.all(sectionTasks);
    }

    if (failList.length > 0) {
        event.sender.send('log', `Retrying failed downloads for ${failList.length} chapters...`);
        const retryTasks = failList.map(({
                                             text,
                                             link,
                                             downloadPath
                                         }) => limitDownloads(() => downloadChapter(link, downloadPath, event, browser)));
        await Promise.all(retryTasks);
        event.sender.send('log', `<br> Retry process completed!`);
    } else {
        event.sender.send('log', '<br><span class="warning">No failed downloads to retry.</span>');
    }

    failList = [];
    // Close the new tab after processing
    await page.close();
}


/**
 * @param url
 * @param browser
 * @param event
 * @param downloadDir
 * @return {Promise<void>}
 */
async function downloadTopicQuestions(url, browser, event, downloadDir) {
    console.log(`Navigating to: ${url}`);
    // Open a new page for each link
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'networkidle2'});

    // Do something on the new page, like extracting data, downloading content, etc.
    console.log(`Successfully navigated to ${url}`);

    // Find the anchor tag with class 'btn' and exact text 'PDF Question Downloads' and click it
    const downloadPageHandler = await page.locator("::-p-xpath(//a[contains(@class, 'btn') and span[normalize-space(text()) = 'PDF Question Downloads']])").waitHandle();
    const downloadPageUrl = await downloadPageHandler.evaluate(el => el.href);
    await page.goto(downloadPageUrl, {waitUntil: 'networkidle2'});

    const questionsContent = await page.waitForSelector('::-p-xpath(//*[contains(@class, "questions_content_")])')
    const sections = await questionsContent.$$('div[class^="Wrapper_wrapper__"][class*="bg-body-"]');

    const limitSections = pLimit(parseInt(process.env.CONCURRENT_SECTIONS_LIMIT) || 3);
    const limitDownloads = pLimit(parseInt(process.env.CONCURRENT_DOWNLOAD_LIMIT) || 5);

    let sectionCount = 1;
    for (const section of sections) {
        //Section Directory
        const sectionTitle = await section.$eval('[class^="Collapse_heading"', el => el.innerText.trim().replace(':', '-'));
        const sectionPath = path.join(downloadDir, `${sectionTitle}`);
        if (!fs.existsSync(sectionPath)) fs.mkdirSync(sectionPath);

        console.log('\n Section :: ', sectionTitle);

        const subSections = await section.$$('div[class^="Wrapper_wrapper__"].bg-body');

        const sectionQuestions = subSections.map((subSection) => limitSections(async () => {
            //Sub Section Directory
            const subSectionTitle = await subSection.$eval('[class^="Collapse_heading"', el => el.innerText.trim().replace(':', '-'));
            const subSectionPath = path.join(sectionPath, subSectionTitle);
            if (!fs.existsSync(subSectionPath)) fs.mkdirSync(subSectionPath);

            const downloadRow = await subSection.$$('table[class^="Wrapper_wrapper_"] > tbody > tr');

            const downloadTasks = downloadRow.map((row) => limitDownloads(() => downloadTopicQuestionPDF(row, subSectionPath, event, subSectionTitle)));

            await Promise.all(downloadTasks);

        }));

        //Log
        event.sender.send('log', `<br><span class="success"><i class="fas fa-download fa-bounce loader"></i> Downloading ${sectionTitle} section's topic questions...</span>
        `);

        await Promise.all(sectionQuestions);
    }


    if (failList.length > 0) {
        event.sender.send('log', `<br> Retrying failed downloads for ${failList.length} chapters...`);
        const retryTasks = failList.map(({
                                             row,
                                             subSectionPath,
                                             event,
                                             subSectionTitle
                                         }) => limitDownloads(() => downloadTopicQuestionPDF(row, subSectionPath, event, subSectionTitle)));
        await Promise.all(retryTasks);
        event.sender.send('log', `<br>Retry process completed!`);
    } else {
        event.sender.send('log', '<br> <span class="warning">No failed downloads to retry.</span>');
    }


    // Close the new tab after processing
    await page.close();
}


/**
 *
 * @param subSection
 * @param sectionPath
 * @param event
 * @param page
 * @param browser
 * @return {Promise<void>}
 */
async function navigateToSubSection(subSection, sectionPath, event, page, browser) {
    const subSectionTitle = await subSection.$eval('a[class^="CollapseWithLink_link__"]', el => el.innerText.trim().replace(':', '-'));
    const subSectionPath = path.join(sectionPath, subSectionTitle);

    if (!fs.existsSync(subSectionPath)) {
        fs.mkdirSync(subSectionPath);
    }

    // Wait for the elements to be available in the DOM
    const subSectionContent = await page.waitForSelector('div[class*="CollapseWithLink_content__"]');

    // const subSectionContent = await subSection.$('div[class^="CollapseWithLink_content__"]');
    const downloadLinks = await subSectionContent.$$('.btn.btn-link.justify-content-center[class*="Navigation_subtopicButton__"]');

    const downloadTasks = downloadLinks.map((link) => downloadChapter(link, subSectionPath, event, browser));

    await Promise.all(downloadTasks);
}

/**
 *
 * @param link
 * @param downloadPath
 * @param event
 * @param browser
 * @return {Promise<void>}
 */
async function downloadChapter(link, downloadPath, event, browser) {
    const text = await link.evaluate(el => el.innerText.trim().replace(':', '-'));
    const url = await link.evaluate(el => el.href);

    const chapterPage = await browser.newPage();

    try {
        const pdfName = `${text}.pdf`;

        if (fs.existsSync(path.join(downloadPath, pdfName))) {
            event.sender.send('log', `<span class="warning pl-3 indent"> ${pdfName} already exists!</span>`);
            return;
        }

        event.sender.send('log', `<span class="pl-3"><i class="fas fa-download fa-fade loader pl-2"></i> Downloading chapter: ${text}</span>`);
        const response = await chapterPage.goto(url, {waitUntil: 'networkidle2'});

        if (response.status() === 429) {
            throw new Error('Rate limit hit!');
        }

        await chapterPage.waitForSelector('a[data-cy="notes-download-link"]', {visible: true});
        const pdfUrl = await chapterPage.$eval('a[data-cy="notes-download-link"]', el => el.href);

        if (pdfUrl) {
            const pdfBuffer = await downloadProgress(chapterPage, pdfUrl);
            fs.writeFileSync(path.join(downloadPath, pdfName), Buffer.from(pdfBuffer));
            event.sender.send('log', `<span class="success pl-3"><i class="fas fa-circle-check loader pl-2"></i> Downloaded ${pdfName} successfully!</span>`);
        } else {
            event.sender.send('log', `<span class="warning indent">No download link found for chapter: ${text}</span>`);
        }
    } catch (error) {
        failList.push({link, downloadPath, event, browser});
        event.sender.send('log', `<span class="danger pl-3 indent">Error downloading chapter ${text}</span>`);
    } finally {
        await chapterPage.close();
    }
}

/**
 *
 * @param page
 * @param pdfUrl
 * @return {Promise<*>}
 */
async function downloadProgress(page, pdfUrl) {
    return page.evaluate(async (pdfUrl) => {
        const response = await fetch(pdfUrl);
        const arrayBuffer = await response.arrayBuffer();
        return Array.from(new Uint8Array(arrayBuffer));
    }, pdfUrl);
}


/**
 * @desc Download Topic Question PDF
 * @param {CdpElementHandle} row
 * @param {string} downloadPath
 * @param event
 * @param subSectionTitle
 * @return {Promise<void>}
 */
async function downloadTopicQuestionPDF(row, downloadPath, event, subSectionTitle) {
    const textElement = await row.$('[class^="DownloadsTable_text_"]');
    const linkElement = await row.$('td a[data-cy="question-download-button"]');  // Target the <a> tag inside the td
    const text = await textElement.evaluate(el => el.innerText.trim().replace(':', '-'));  // Get the text from the td
    const questionTitle = `${subSectionTitle} - ${text}`;

    try {
        if (textElement && linkElement) {
            const pdfUrl = await linkElement.evaluate(el => el.href);  // Get the text from the td
            console.log(`Sub Section :: ${questionTitle}`)

            const pdfName = `${text}.pdf`;

            if (fs.existsSync(path.join(downloadPath, pdfName))) {
                event.sender.send('log', `<span class="warning pl-3 indent pl-2">${questionTitle}.pdf already exists!</span>`);
                return;
            }

            event.sender.send('log', `<span class="pl-3"><i class="fas fa-download fa-fade loader pl-2"></i> Downloading ${questionTitle}</span>`);

            if (pdfUrl) {
                const response = await fetch(pdfUrl);
                const arrayBuffer = await response.arrayBuffer();
                const pdfBuffer = Array.from(new Uint8Array(arrayBuffer));
                fs.writeFileSync(path.join(downloadPath, pdfName), Buffer.from(pdfBuffer));
                event.sender.send('log', `<span class="success pl-3"><i class="fas fa-circle-check loader pl-2"></i> Downloaded ${questionTitle} successfully!</span>`);
            } else {
                event.sender.send('log', `<span class="danger pl-3 indent">No download link found for chapter: ${text}</span>`);
            }
        }

    } catch (error) {
        failList.push({row, downloadPath, event, subSectionTitle});
        event.sender.send('log', `<span class="danger pl-3 indent">Error downloading topic question ${questionTitle}: ${error.message}</span>`);
    }
}
