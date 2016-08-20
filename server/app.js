
// Set up some useful global utilities
global.log = console.log.bind(console);
global.logErr = (err) => {
	log(err);
	throw err;
};

import 'isomorphic-fetch';
import {init as dbInit} from './db-init';
dbInit();
// create a koa app and initialise the database
import Koa from 'koa';
const app = new Koa();

// handle errors
app.use(async (ctx, next) => {
	try {
		await next();
	} catch (err) {
		log(err);
		log(ctx);
	}
});

// static assets
import serve from 'koa-static';
import mount from 'koa-mount';
app.use(serve('public'));


// templating and global setup
app.use(async (ctx, next) => {
	// useful bits and pieces for the view
	ctx.data = {};

	await next();

	ctx.type = 'text/html';
});

// routing
import qs from 'koa-qs';
import koaRouter from 'koa-router';

qs(app);
const router = koaRouter();

const page = `<!DOCTYPE html>
<head>
	<title>NPM GARRY</title>
	<style>
	.incomplete {color: red}
	.complete {color: green}
	</style>
</head>
<body>
	<header><h1>npm garry<h1> <h2>- what moves does your dependency tree have up its sleeves?</h2></header>
	<main>{body}</main>

</body>`

router.get('/', async (ctx, next) => {
	ctx.body = page.replace(/{body}/, `\
<form action="/package" method="get">
	<input id="package" name="package"><label for="package">Enter a package name to analyse</label>
	<button type="submit">Submit</button>
</form>
`)
	next();
});

router.get('/package', async (ctx, next) => {
	ctx.body = page.replace(/{body}/, `\
<h3>Results are coming in for ${ctx.query.package}</h3>
<div id="tree"></div>
<script src="/socket.io/socket.io.js"></script>
<script>var packageName = '${ctx.query.package}';</script>
<script src="/main.js"></script>

`)

	// <script src="https://cdn.jsdelivr.net/riot/2.5/riot.min.js"></script>
// <script src="/tags.js"></script>
// <script>riot.mount('tree', {
// 	package: '${ctx.query.package}',
// 	dependencies: []
// })</script>
	next();
});

const getTree = require('./get-tree')

app
	.use(router.routes())
	.use(router.allowedMethods())

const IO = require( 'koa-socket' )
const io = new IO()

io.attach( app )

app.io.on('connection', ctx => {
  console.log('a user connected');
  const socket = ctx.socket;

  socket.on('package', async packageName => {
		const npm = await fetch(`https://registry.npmjs.org/${packageName}/latest?json=true`).then(res => res.json());
		if (npm.error) {
			socket.emit('error', 'not a valid package name');
			socket.disconnect();
		}

		const [tree, complete] = await getTree({
			name: packageName,
			semverRange: npm.version,
			packageJson: npm,
			topLevel: true,
			channel: {
				update: () => {
					socket.emit('tree', tree);
				}
			}
		});
		socket.emit('tree', tree);

		await complete
		socket.emit('tree', tree);
		socket.disconnect();

		//TODO
		//send tiny updates rather than the entire object every time


  });
});

// app.io.on( 'join', ( ctx, data ) => {
//   console.log( 'join event fired', data )
// })


app.listen(process.env.PORT || 3001, function () {
	console.log(`listening on ${process.env.PORT || 3001}`);
})


