import { createServer } from 'http';
import { mockTemplates, mockAttackRanges, mockAttackRangeDetail } from './mocks.js';

const PORT = 4000;

const server = createServer((req, res) => {
	res.setHeader('Content-Type', 'application/json');
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	if (req.method === 'OPTIONS') {
		res.writeHead(200);
		res.end();
		return;
	}

	const url = req.url || '/';

	if (url === '/templates') {
		res.writeHead(200);
		res.end(JSON.stringify({
			templates: mockTemplates.templates,
			provider_availability: mockTemplates.providerAvailability,
		}));
		return;
	}

	if (url === '/attack-range/list') {
		res.writeHead(200);
		res.end(JSON.stringify(mockAttackRanges));
		return;
	}

	if (url.startsWith('/attack-range/status/')) {
		res.writeHead(200);
		res.end(JSON.stringify(mockAttackRangeDetail));
		return;
	}

	if (url === '/suggested-ip' || url === '/public-ip') {
		res.writeHead(200);
		res.end(JSON.stringify({ ip: '1.2.3.4', cidr: '1.2.3.4/32' }));
		return;
	}

	if (url.startsWith('/templates/')) {
		res.writeHead(200);
		res.end(JSON.stringify({ content: {} }));
		return;
	}

	res.writeHead(404);
	res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
	console.log(`Mock API server running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
	server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
	server.close(() => process.exit(0));
});
