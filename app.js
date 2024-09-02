const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const getConfig = () => {
  try {
    const data = fs.readFileSync('./config.json', { encoding: 'utf8' });
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

// MongoDB
const config = getConfig();
const PORT = config.port || 8088;

// App
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const queue = {};

let connections = 0;

const logging = () => {
  console.log(`\x1b[32mConection Active : ${connections}\x1b[0m`);
}

// Client
class Client {
  conn;
  ws;
  uid;
  methods = [
    'mining.extranonce.subscribe',
    'mining.suggest_difficulty',
    'mining.subscribe',
    'mining.authorize',
    'mining.submit',
  ]

  constructor(host, port, ws) {
    this.conn = net.createConnection(port, host);
    this.ws = ws;
    this.uid = uuidv4();
    this.initSender();
    this.initReceiver();
  }

  initSender = () => {
    this.ws.on('message', (cmd) => {
      try {
        const command = JSON.parse(cmd);
        const method = command.method;
        if (this.methods.includes(method)) {
          this.conn.write(cmd);
        }
      } catch (error) {
        console.log(`[${new Date().toISOString()}][MINER] ${error?.message || error}`);
      }
    });

    this.ws.on('close', () => {
      this.conn.end();
    });
  }

  initReceiver = () => {
    this.conn.on('data', (data) => {
      if (data.toString()) {
        this.ws.send(data.toString());
      }
    });

    this.conn.on('end', () => {
      this.ws.close();
    });

    this.conn.on('error', (error) => {
      console.log(`[${new Date().toISOString()}][POOL] ${error?.message || error}`);
    });
  }
}

// Proxy
async function proxyMain(ws, req) {
  let inited = false;
  ws.on('message', (message) => {
    if (inited) return;
    let command = JSON.parse(message);
    if (command.method === 'proxy.connect' && command.params.length === 2) {
      const [host, port] = command.params || [];
      if (!host || !port) return;

      const client = new Client(host, port, ws);
      queue[client.uid] = client;
      connections++;
      logging();
      inited = true;
      ws.on('close', () => {
        delete queue[client.uid];
        connections--;
        logging();
      });
    }
  });
}
wss.on('connection', proxyMain);

// Start server
server.listen(PORT, "0.0.0.0", () => {
  logging();
});
