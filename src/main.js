const {app, BrowserWindow, ipcMain, dialog, Menu, shell} = require('electron');
const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');
const {autoUpdater} = require('electron-updater');
const log = require('electron-log');

const {adjustConcurrencyLimits} = require('./concurrencyManager');
const retry = require('async-retry'); // To handle retries


// Load environment variables
dotenv.config();

let mainWindow;

// Set up logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

let failList = [];
let browserInstances = []; // Track active browser instances

const PUPPETEER_HEADLESS = true

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
        type: 'error', title: 'Update Error', message: `Error occurred during update`
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
    const menu = Menu.buildFromTemplate([{
        label: 'File', submenu: [{role: 'quit'} // Only include essential options
        ]
    }, {
        label: 'Update', click: () => {
            autoUpdater.checkForUpdatesAndNotify().then(r => {
            });
            dialog.showMessageBoxSync({
                type: 'info', title: 'App Update', message: 'Coming soon!', buttons: ['OK']
            });
        }
    }, {
        label: 'Help', submenu: [{
            label: 'About Us', click: () => {
                dialog.showMessageBoxSync({
                    type: 'info', title: 'About Us', message: `This application is dedicated to my princess daughter, Mirza Haris, my everything, with endless love and gratitude.

         "Dream big, little one, for the future is bright, and the world is yours to explore."`, buttons: ['OK']
                });
            }
        }]
    }]);
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
        headless: PUPPETEER_HEADLESS,
        args: ['--window-size=20,20', '--window-position=0,0']
    });

    const page = await browser.newPage();

    // Set the window to always be on top
    mainWindow.focus();

    await loginToWebsite(page, event);

    //Minimize Active windows
    // await minimizeWin(browser);

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

        subjects.push({id: `${subjectTitle}-${subjectLevel}`, subjectTitle, subjectLevel, resourceUrl})
    }

    event.sender.send('set-data', subjects);

    //Loader set to hidden
    event.sender.send('loading', false);
    await browser.close();
});


// Retry wrapper to handle failures
const retryDownload = async (fn, retries = 3) => {
    return retry(async () => await fn(), {
        retries,
        factor: 2,
        minTimeout: 1000, // Initial wait 1s
        maxTimeout: 5000, // Max wait 5s
    });
};


ipcMain.on('start-download', async (event, {subjects, downloadPath}) => {
    if (!subjects.length) {
        event.sender.send('log', 'No URLs provided.');
        return;
    }

    event.sender.send('loading', true);

    const downloadDir = downloadPath;
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, {recursive: true});
    }

    let browser;

    try {
        browser = await puppeteer.launch({
            headless: PUPPETEER_HEADLESS,
            args: ['--window-size=20,20', '--window-position=0,0']
        }); // Adjust as necessary
        const page = await browser.newPage();
        mainWindow.focus();

        await loginToWebsite(page, event);
        // Limit concurrent downloads based on system conditions (as discussed earlier)
        const limitDownloads = pLimit(5); // Adjust this dynamically if needed


        for (const subject of subjects) {
            event.sender.send('log', `<span class="app-log"><i class="fa-solid fa-hourglass-end fa-flip" style="--fa-flip-x: 1; --fa-flip-y: 0;"></i>Processing: ${subject.subjectName}</span>`);

            // Use concurrency control for downloads
            await limitDownloads(async () => {
                await page.goto(subject.resourceUrl, {waitUntil: 'networkidle2'});

                const sectionContainer = await page.waitForSelector('div[id^="collapse-"][class~="collapse"][class~="show"]');

                const revisionNotesLinks = await sectionContainer.evaluate(() => {
                    const links = document.querySelectorAll('div[id^="collapse-"][class~="collapse"][class~="show"] a[class^="ResourceLink_link_"]');
                    return Array.from(links)
                        .filter(link => {
                            const textElement = link.querySelector('[class^="ResourceLink_text__"]');
                            return textElement && (textElement.innerText.trim() === 'Revision Notes' || textElement.innerText.trim() === 'Exam Questions');
                        })
                        .map(link => ({
                            url: link.href,
                            type: link.querySelector('[class^="ResourceLink_text__"]').innerText.trim(),
                        }));
                });

                if (revisionNotesLinks.length > 0) {
                    const mainTitle = await page.$eval('h1[class^="Hero_h1_"]', el => el.innerText.trim().replace(':', '-'));

                    for (const {url, type} of revisionNotesLinks) {
                        const mainPath = path.join(downloadDir, mainTitle, type);

                        if (!fs.existsSync(mainPath)) {
                            fs.mkdirSync(mainPath, {recursive: true});
                        }
                        ipcMain.emit('update-download-counts', event, {
                            id: subject.id,
                            savedLocation: path.join(downloadDir, mainTitle)
                        });

                        if (type === 'Revision Notes') {
                            console.log('Revision Notes links found:', url);
                            event.sender.send('log', `<span class="app-log info"><i class="fa-solid fa-network-wired"></i> Initialize Revision Notes Download</span>`);
                            await downloadRevisionNotes(url, browser, event, mainPath, subject);
                        } else if (type === 'Exam Questions') {
                            console.log('Exam Questions links found:', url);
                            event.sender.send('log', `<span class="app-log info"><i class="fa-regular fa-circle-question"></i> Initialize Exam Questions Download</span>`);
                            await downloadTopicQuestions(url, browser, event, mainPath, subject);
                        }
                    }
                } else {
                    console.log('No download links found for', subject.subjectName);
                }

                //MarkAsCompleted
                event.sender.send('markAsDownloaded', subject);

            });
        }

        await browser.close();
        event.sender.send('log', '<span class="app-log success"><i class="fa-regular fa-face-smile-wink"></i>All downloads finished!</span>');
        event.sender.send('loading', false);
    } catch (error) {
        log.error('Error during download process:', error);
        event.sender.send('log', `<span class="app-log danger"><i class="fa-regular fa-face-frown"></i> Error during the download process, You may retry it again.</span>`);
        event.sender.send('loading', false);

        if (browser) {
            await browser.close();
        }
    }
});
//
// // Listen for 'start-download' event from the renderer process
// ipcMain.on('start-download', async (event, {subjects, downloadPath}) => {
//     if (!subjects.length) {
//         event.sender.send('log', 'No URLs provided.');
//         return;
//     }
//
//     event.sender.send('loading', true);
//
//     const downloadDir = downloadPath;
//     if (!fs.existsSync(downloadDir)) {
//         fs.mkdirSync(downloadDir);
//     }
//
//     try {
//         const browser = await puppeteer.launch({
//             headless: PUPPETEER_HEADLESSS, // args: ['--window-size=20,20', '--window-position=0,0'] // Start maximized if needed
//         });
//         const page = await browser.newPage();
//
//
//         // Set the window to always be on top
//         mainWindow.focus();
//
//         await loginToWebsite(page, event);
//
//         //Minimize Active windows
//         // await minimizeWin(browser);
//
//         for (const subject of subjects) {
//             event.sender.send('log', `\nProcessing : ${subject.subjectName}`);
//
//             // Go to target page
//             await page.goto(subject.resourceUrl, {waitUntil: 'networkidle2'});
//
//             // Wait for the container div to load
//             const sectionContainer = await page.waitForSelector("::-p-xpath(//div[contains(@class, 'collapse') and contains(@class, 'show')])");
//
//             // Find all the `a` tags with "Revision Notes" and get their href attributes
//             const targetEl = ['Revision Notes', 'Topic Questions'];
//
//             const revisionNotesLinks = await sectionContainer.evaluate((params) => {
//                 // const container = params.querySelector('div[class^="level-subject-overview_links__"]');
//                 // if (container) {
//                 const links = params.querySelectorAll('a[class^="ResourceLink_link_"]');
//
//                 return Array.from(links)
//                     .filter(link => {
//                         const textElement = link.querySelector('[class^="ResourceLink_text__"]');
//                         return textElement && (textElement.innerText.trim() === 'Revision Notes' || textElement.innerText.trim() === 'Exam Questions');
//                     })
//                     .map(link => ({
//                         url: link.href, type: link.querySelector('[class^="ResourceLink_text__"]').innerText.trim()
//                     }));
//                 // }
//                 // return [];
//             });
//
//             if (revisionNotesLinks.length > 0) {
//                 const mainTitle = await page.$eval('h1[class^="Hero_h1_"]', el => el.innerText.trim().replace(':', '-'));
//
//                 // Loop through each link and navigate to the page
//                 for (const {url, type} of revisionNotesLinks) {
//
//                     //create or use existing downloads location
//                     const mainPath = path.join(downloadDir, mainTitle, type);
//
//                     if (type === 'Exam Questions') {
//                         // Specify the old and new directory names
//                         const oldDir = path.join(downloadDir, mainTitle, 'Topic Questions');
//                         const newDir = path.join(downloadDir, mainTitle, type);
//
//                         //Topics Questions
//                         if (fs.existsSync(oldDir)) {
//                             fs.rename(oldDir, newDir, err => {
//                                 if (err) {
//                                     console.error('Error renaming directory:', err);
//                                 } else {
//                                     console.log('Directory renamed successfully!');
//                                 }
//                             });
//                         }
//                     }
//
//                     if (!fs.existsSync(mainPath)) {
//                         fs.mkdirSync(mainPath, {recursive: true});
//                     }
//
//                     try {
//                         //Download Revision Notes
//                         if (type === 'Revision Notes') {
//                             console.log('Revision Notes links found:', url);
//                             event.sender.send('log', `<br><br><span class="info"><i class="fa-solid fa-network-wired"></i> Initialize Revision Notes Download</span>`);
//                             await downloadRevisionNotes(url, browser, event, mainPath, subject);
//                         } else {
//                             console.log('Exam Questions links found:', url);
//                             event.sender.send('log', `<br><br><span class="info"><i class="fa-regular fa-circle-question"></i> Initialize Exam Questions Download</span>`);
//                             await downloadTopicQuestions(url, browser, event, mainPath, subject);
//                         }
//                     } catch (e) {
//                         log.error('During download process error:', e);
//                         event.sender.send('log', `<span class="danger pl-3 indent pl-2">Error during download process</span>`);
//                     }
//                 }
//             } else {
//                 console.log('No Downloads links found.');
//             }
//         }
//
//         await browser.close();
//         event.sender.send('log', `<br> <span class="success"><i class="fa-regular fa-circle-check"></i> All downloads finished!</span>`);
//         event.sender.send('loading', false);
//     } catch (error) {
//         log.error('During download process error:', error);
//         event.sender.send('loading', false);
//         event.sender.send('log', `<span class="danger">Error during download process</span>`);
//     }
// });


/**
 *
 * @param page
 * @param event
 * @return {Promise<void>}
 */
async function loginToWebsite(page, event) {
    try {
        await page.goto('https://www.savemyexams.com/login/?method=email-password', {waitUntil: 'networkidle2'});
        await page.type('#email-page', process.env.ACCOUNT_EMAIL);
        await page.type('#password-page', process.env.ACCOUNT_PASSWORD);
        await page.click('[data-healthcheck="login-button"]');
        event.sender.send('log', `<span class="app-log"><i class="fas fa-lock fa-flip"></i> Logging into your account...</span>`);

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
 * @param subjectInfo
 * @return {Promise<void>}
 */
async function downloadRevisionNotes(url, browser, event, downloadDir, subjectInfo) {
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

    //Manage Concurrency
    const {sectionLimit, downloadLimit} = await adjustConcurrencyLimits();
    const limitSections = pLimit(sectionLimit);
    const limitDownloads = pLimit(downloadLimit);

    //Minimize Active windows
    // await minimizeWin(browser);

    for (const section of mainSections) {
        const sectionTitle = await section.$eval('a[class^="CollapseWithLink_link_"]', el => el.innerText.trim().replace(':', '-'));
        const sectionPath = path.join(downloadDir, sectionTitle);

        if (!fs.existsSync(sectionPath)) {
            fs.mkdirSync(sectionPath);
        }

        const subSections = await section.$$('[data-cy^="nav-topic-"]');
        const sectionTasks = subSections.map((subSection) => limitSections(() => navigateToSubSection(subSection, sectionPath, event, page, browser, subjectInfo)));

        event.sender.send('log', `<span class="success app-log"><i class="fas fa-download fa-bounce"></i> Downloading ${sectionTitle} section's topics...</span>`);
        await Promise.all(sectionTasks);
    }

    //Try failed downloads
    await processFailedNotesDownload(limitDownloads, browser, event, subjectInfo);

    // Close the new tab after processing
    await page.close();
}

/**
 *
 * @param limitDownloads
 * @param browser
 * @param event
 * @param subjectInfo
 * @return {Promise<void>}
 */
async function processFailedNotesDownload(limitDownloads, browser, event, subjectInfo) {
    if (failList.length > 0) {
        event.sender.send('log', `<br><span class="info">Retrying failed downloads for ${failList.length} chapters...</span>`);
        const retryTasks = failList.map(({
                                             text, link, downloadPath, subjectInfo
                                         }) => limitDownloads(() => downloadChapter(link, downloadPath, event, browser, subjectInfo)));
        failList = [];
        await Promise.all(retryTasks);
        event.sender.send('log', `<br> Retry process completed!`);
    } else {
        event.sender.send('log', '<br><span class="warning">No failed downloads to retry.</span>');
    }

    if (failList.length > 0) {
        await processFailedNotesDownload(limitDownloads, browser, event, subjectInfo);
    }
}

/**
 * @param url
 * @param browser
 * @param event
 * @param downloadDir
 * @param subjectInfo
 * @return {Promise<void>}
 */
async function downloadTopicQuestions(url, browser, event, downloadDir, subjectInfo) {
    console.log(`Navigating to: ${url}`);
    // Open a new page for each link
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'networkidle2'});

    // Do something on the new page, like extracting data, downloading content, etc.
    console.log(`Successfully navigated to ${url}`);

    // Find the anchor tag with class 'btn' and exact text 'PDF Question Downloads' and click it
    const questionsContent = await page.waitForSelector('[class^="TopicQuestionsOverviewPage_list__"]')
    const sections = await questionsContent.$$('[class^="TopicQuestionsOverviewPage_listItem__"');

    //Manage Concurrency
    const {downloadLimit} = await adjustConcurrencyLimits();
    const limitDownloads = pLimit(downloadLimit);

    //Minimize Active windows
    // await minimizeWin(browser);

    let sectionCount = 1;
    for (const section of sections) {
        //Section Directory
        const sectionTitle = await section.$eval('[class~="link-body-emphasis"]', el => el.innerText.trim().replace(':', '-'));
        const sectionPath = path.join(downloadDir, sectionTitle);
        if (!fs.existsSync(sectionPath)) fs.mkdirSync(sectionPath);

        console.log('\n Section :: ', sectionTitle);

        const subSections = await section.$$('[class^="TopicQuestionsOverviewPage_cards___"] > li');

        const sectionQuestions = subSections.map((subSection) => limitDownloads(async () => {
            //Sub Section Directory
            const subSectionTitle = await subSection.$eval('a div p', el => el.innerText.trim().replace(':', '-'));
            const subSectionPath = sectionPath;//path.join(sectionPath, subSectionTitle);
            if (!fs.existsSync(subSectionPath)) fs.mkdirSync(subSectionPath);

            const downloadUrl = await subSection.$eval('[data-cy="question-download-button"]', el => el.href);
            await downloadTopicQuestionPDF(downloadUrl, subSectionPath, event, subSectionTitle, subjectInfo)
        }));

        //Log
        event.sender.send('log', `<span class="app-log success"><i class="fas fa-download fa-bounce"></i> Downloading ${sectionTitle} section's topic questions...</span>`);

        ipcMain.emit('update-download-counts', event, {id: subjectInfo.id, totalCount: sectionQuestions.length});

        await Promise.all(sectionQuestions);
    }

    await processFailedQuestionPdfDownloads(limitDownloads, event);

    // Close the new tab after processing
    await page.close();
}

/**
 *
 * @param limitDownloads
 * @param event
 * @return {Promise<void>}
 */
async function processFailedQuestionPdfDownloads(limitDownloads, event) {

    if (failList.length > 0) {
        event.sender.send('log', `<br><br><span class="info"> Retrying failed downloads for ${failList.length} chapters...</span>`);
        const retryTasks = failList.map(({
                                             pdfUrl,
                                             downloadPath,
                                             event,
                                             questionTitle,
                                             subjectInfo
                                         }) => limitDownloads(() => downloadTopicQuestionPDF(pdfUrl, downloadPath, event, questionTitle, subjectInfo)));
        failList = []
        await Promise.all(retryTasks);
        event.sender.send('log', `<br>Retry process completed!`);
    } else {
        event.sender.send('log', '<span class="app-log warning">No failed downloads to retry.</span>');
    }

    if (failList.length > 0) {
        await processFailedQuestionPdfDownloads(limitDownloads, event)
    }
}


/**
 *
 * @param subSection
 * @param sectionPath
 * @param event
 * @param page
 * @param browser
 * @param subjectInfo
 * @return {Promise<void>}
 */
async function navigateToSubSection(subSection, sectionPath, event, page, browser, subjectInfo) {
    const subSectionTitle = await subSection.$eval('a[class^="CollapseWithLink_link__"]', el => el.innerText.trim().replace(':', '-'));
    const subSectionPath = path.join(sectionPath, subSectionTitle);

    if (!fs.existsSync(subSectionPath)) {
        fs.mkdirSync(subSectionPath);
    }

    // Wait for the elements to be available in the DOM
    const subSectionContent = await subSection.waitForSelector('div[class*="CollapseWithLink_content__"]');
    const downloadLinks = await subSectionContent.$$('.btn.btn-link.justify-content-center[class*="Navigation_subtopicButton__"]');

    const {downloadLimit} = await adjustConcurrencyLimits();
    const limitDownloads = pLimit(downloadLimit);

    const downloadTasks = downloadLinks.map(async (link) => {
        await limitDownloads(async () => {
            await retryDownload(async () => {
                await downloadChapter(link, subSectionPath, event, browser, subjectInfo)
            })
        });
    });

    ipcMain.emit('update-download-counts', event, {id: subjectInfo.id, totalCount: downloadTasks.length});

    await Promise.all(downloadTasks);
}

/**
 *
 * @param link
 * @param downloadPath
 * @param event
 * @param browser
 * @param subjectInfo
 * @return {Promise<void>}
 */
async function downloadChapter(link, downloadPath, event, browser, subjectInfo) {
    const text = await link.evaluate(el => el.innerText.trim().replace(':', '-'));
    const url = await link.evaluate(el => el.href);

    const chapterPage = await browser.newPage();
    //Minimize Active windows
    // await minimizeWin(browser);

    try {
        const pdfName = `${text}.pdf`;

        if (fs.existsSync(path.join(downloadPath, pdfName))) {
            ipcMain.emit('update-download-counts', event, {id: subjectInfo.id, downloadedCount: 1});
            //Downloading log
            event.sender.send('log', `<span class="download-log warning"><i class="fa-solid fa-circle-info"></i> ${pdfName} already exists!</span>`);
            return;
        }

        //Downloading log
        event.sender.send('log', `<span class="download-log"><i class="fas fa-download fa-fade"></i> Downloading chapter: ${text}</span>`);
        const response = await chapterPage.goto(url, {waitUntil: 'networkidle2'});

        if (response.status() === 429) {
            throw new Error('Rate limit hit!');
        }

        await chapterPage.waitForSelector('a[data-cy="notes-download-link"]', {visible: true});
        const pdfUrl = await chapterPage.$eval('a[data-cy="notes-download-link"]', el => el.href);

        if (pdfUrl) {
            const pdfBuffer = await downloadProgress(chapterPage, pdfUrl);
            fs.writeFileSync(path.join(downloadPath, pdfName), Buffer.from(pdfBuffer));
            //updateDownloadStatus
            ipcMain.emit('update-download-counts', event, {id: subjectInfo.id, downloadedCount: 1});

            //Downloading log
            event.sender.send('log', `<span class="download-log success"><i class="fas fa-circle-check"></i> ${pdfName} Downloaded successfully!</span>`);
        } else {
            event.sender.send('log', `<span class="warning indent">No download link found for chapter: ${text}</span>`);
        }
    } catch (error) {
        failList.push({link, downloadPath, event, browser, subjectInfo});
        event.sender.send('log', `<span class="download-log danger"><i class="fa-solid fa-triangle-exclamation"></i> Download failed chapter ${text}</span>`);
        log.error('Downloading chapter error:', error);
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
 * @param pdfUrl
 * @param {string} downloadPath
 * @param event
 * @param questionTitle
 * @param subjectInfo
 * @return {Promise<void>}
 */
async function downloadTopicQuestionPDF(pdfUrl, downloadPath, event, questionTitle, subjectInfo) {

    try {
        console.log(`Sub Section :: ${questionTitle}`)
        const pdfName = `${questionTitle}.pdf`;

        if (fs.existsSync(path.join(downloadPath, pdfName))) {
            ipcMain.emit('update-download-counts', event, {id: subjectInfo.id, downloadedCount: 1});
            event.sender.send('log', `<span class="download-log warning"><i class="fa-solid fa-circle-info"></i> ${questionTitle}.pdf already exists!</span>`);
            return;
        }

        event.sender.send('log', `<span class="download-log"><i class="fas fa-download fa-fade"></i> Downloading ${questionTitle}</span>`);

        if (pdfUrl) {
            const response = await fetch(pdfUrl);
            const arrayBuffer = await response.arrayBuffer();
            const pdfBuffer = Array.from(new Uint8Array(arrayBuffer));
            fs.writeFileSync(path.join(downloadPath, pdfName), Buffer.from(pdfBuffer));
            ipcMain.emit('update-download-counts', event, {id: subjectInfo.id, downloadedCount: 1});
            event.sender.send('log', `<span class="download-log success"><i class="fas fa-circle-check"></i> Downloaded ${questionTitle} successfully!</span>`);
        } else {
            event.sender.send('log', `<span class="danger pl-3 indent">No download link found for chapter: ${questionTitle}</span>`);
        }
    } catch (error) {
        failList.push({pdfUrl, downloadPath, event, questionTitle, subjectInfo});
        event.sender.send('log', `<span class="download-log danger"><i class="fa-solid fa-triangle-exclamation"></i> Download failed topic question ${questionTitle}:</span>`);
        log.error('Downloading topic question error:', error);
    }
}

// Listener for internal event
ipcMain.on('update-download-counts', (event, downloadData) => {
    console.log('Download started:', downloadData);
    event.sender.send('updateDownloadStatus', downloadData);
});


// Listen for the 'open-folder' event from the renderer
ipcMain.on('open-folder', (event, folderPath) => {
    // Use Electron's shell to open the folder in the default file explorer
    shell.openPath(folderPath)
        .then(response => {
            if (response) {
                console.error('Failed to open folder:', response);  // Error handling
            }
        });
});

