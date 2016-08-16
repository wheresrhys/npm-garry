import koaRouter from 'koa-router';
import {init, getDb} from './db-init';
init();
const db = getDb();
// const websockify = require('koa-websocket');

// const api = websockify(koa());
// const api = new Koa();
const apiRouter = koaRouter();

apiRouter.get('/package/:name', async (ctx, next) => {
    const dbResult = await db.cypher({
        query: 'MATCH (p:Package {name: {name}}) RETURN p',
        params: {
            name: ctx.params.name,
        },
    }).then(results => {
        var result = results[0];
        if (!result) {
            return db.cypher({
                query: 'CREATE (p:Package {name: {name}}) RETURN p',
                params: {
                    name: ctx.params.name,
                },
            })
        }
        return results;
    })
        .then(results => {
            const result = results[0]
            if(!result) {
                throw 'No results still!';
            }
            var pack = result['p'];
            console.log(JSON.stringify(pack, null, 4));
        });
    ctx.body = 'asdlhaskjdhaskjdh';
  // // `this` is the regular koa context created from the `ws` onConnection `socket.upgradeReq` object.
  // // the websocket is added to the context on `this.websocket`.
  // ctx.websocket.send('Hello World');
  // ctx.websocket.on('message', function(message) {
  //   // do something with the message from client
  //   console.log(message);
  // });
  // yielding `next` will pass the context (this) on to the next ws middleware
  next();
})


module.exports = apiRouter;