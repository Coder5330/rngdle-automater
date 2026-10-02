const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Runs a single RNGdle browser session.
 */
async function runSession(sessionId, socket) {
  let browser = null;
  try {
    socket.emit('log', `[Worker ${sessionId}] Launching browser...`);

    // Configuration optimized for Render / Linux environments
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    socket.emit('log', `[Worker ${sessionId}] Navigating to RNGdle...`);
    await page.goto('https://rngdle.com', { waitUntil: 'networkidle2', timeout: 60000 });

    // --- Action Execution ---
    // Update selectors depending on the target site layout
    socket.emit('log', `[Worker ${sessionId}] Rolling...`);
    
    // Example: Click Roll button if present
    const rollButton = await page.$('button#roll-btn, .roll-button, button');
    if (rollButton) {
      await rollButton.click();
      await new Promise(r => setTimeout(r, 2000)); // Wait for roll animation
    }

    // --- Read LocalStorage / State ---
    socket.emit('log', `[Worker ${sessionId}] Fetching local storage data...`);
    const localStorageData = await page.evaluate(() => {
      let data = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        data[key] = localStorage.getItem(key);
      }
      return data;
    });

    // Extract score or specific keys if known
    const score = localStorageData.score || localStorageData.stats || 'Data retrieved';

    // --- Take Screenshot ---
    socket.emit('log', `[Worker ${sessionId}] Capturing screenshot...`);
    const screenshotBuffer = await page.screenshot({ encoding: 'base64' });

    // Send completed results back to the client
    socket.emit('result', {
      sessionId,
      score,
      localStorage: localStorageData,
      image: `data:image/png;base64,${screenshotBuffer}`
    });

  } catch (err) {
    socket.emit('log', `[Worker ${sessionId}] Error: ${err.message}`);
    socket.emit('result', {
      sessionId,
      error: err.message
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// WebSocket connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('start-automation', async (data) => {
    const connections = parseInt(data.connections, 10) || 1;
    socket.emit('log', `Starting ${connections} parallel automation tasks...`);

    // Run parallel sessions
    const tasks = [];
    for (let i = 1; i <= connections; i++) {
      tasks.push(runSession(i, socket));
    }

    await Promise.all(tasks);
    socket.emit('log', 'All automation sessions finished!');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
