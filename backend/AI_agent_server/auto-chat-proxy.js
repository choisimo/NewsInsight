#!/usr/bin/env node
const http = require('http');
const { URL } = require('url');

const OPENCODE_BASE = process.env.OPENCODE_BASE || 'http://opencode:7012';
const PORT = process.env.PROXY_PORT || 7016;

// HTTP 요청 헬퍼 함수
function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          data: data,
          json: () => JSON.parse(data)
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const requestTime = new Date().toISOString();
  console.log(`[${requestTime}] ${req.method} ${req.url} - Start`);
  
  // CORS 헤더 추가
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    console.log(`[${requestTime}] OPTIONS request - Sending 204`);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/auto-chat') {
    console.log(`[${requestTime}] Invalid request: ${req.method} ${req.url} - Sending 404`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found. Use POST /auto-chat' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      console.log(`[${requestTime}] Request body: ${body}`);
      const data = JSON.parse(body);
      const { title, message, providerID = 'openai', modelID = 'gpt-4.1' } = data;
      
      console.log(`[${requestTime}] Parsed data:`, {
        title: title || 'Auto Session',
        messageLength: message?.length || 0,
        providerID,
        modelID
      });

      if (!message) {
        console.log(`[${requestTime}] Error: message is required`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'message is required' }));
        return;
      }

      const authHeader = req.headers['authorization'] || '';
      console.log(`[${requestTime}] Auth header present: ${!!authHeader}`);

      // 1. 세션 생성
      console.log(`[${requestTime}] Creating session at ${OPENCODE_BASE}/session`);
      const sessionRes = await httpRequest(
        `${OPENCODE_BASE}/session`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          }
        },
        JSON.stringify({ title: title || 'Auto Session' })
      );

      console.log(`[${requestTime}] Session creation response: ${sessionRes.status}`);
      if (!sessionRes.ok) {
        console.log(`[${requestTime}] Session creation failed: ${sessionRes.data}`);
        throw new Error(`Session creation failed: ${sessionRes.status}`);
      }

      const session = sessionRes.json();
      const sessionId = session.id;
      console.log(`[${requestTime}] Session created: ${sessionId}`);

      // 2. 메시지 전송
      console.log(`[${requestTime}] Sending message to session ${sessionId}`);
      const messageRes = await httpRequest(
        `${OPENCODE_BASE}/session/${sessionId}/message`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          }
        },
        JSON.stringify({
          providerID,
          modelID,
          parts: [{ type: 'text', text: message }]
        })
      );

      console.log(`[${requestTime}] Message sending response: ${messageRes.status}`);
      if (!messageRes.ok) {
        console.log(`[${requestTime}] Message sending failed: ${messageRes.data}`);
        throw new Error(`Message sending failed: ${messageRes.status}`);
      }

      const response = messageRes.json();
      console.log(`[${requestTime}] Success - Session: ${sessionId}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessionId,
        response
      }));

    } catch (err) {
      console.error(`[${requestTime}] Error:`, err.message);
      console.error(`[${requestTime}] Stack:`, err.stack);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, stack: err.stack }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[STARTUP] Auto-chat proxy listening on port ${PORT}`);
  console.log(`[STARTUP] OPENCODE_BASE: ${OPENCODE_BASE}`);
  console.log(`[STARTUP] Time: ${new Date().toISOString()}`);
});
