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
<tree></tree>
<script src="https://cdn.jsdelivr.net/riot/2.5/riot.min.js"></script>
<script src="/tags.js"></script>
<script>riot.mount('tree', {
	package: '${ctx.query.package}',
	dependencies: []
})</script>
`)
	next();
});

const apiRouter = require('./api')

router.use('/api', apiRouter.routes(), apiRouter.allowedMethods());



app
	.use(router.routes())
	.use(router.allowedMethods())

app.listen(process.env.PORT || 3001, function () {
	console.log(`listening on ${process.env.PORT || 3001}`);
})
