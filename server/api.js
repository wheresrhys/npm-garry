import koaRouter from 'koa-router';
import {init, getDb} from './db-init';
import semver from 'semver';

init();
const db = getDb();
// const websockify = require('koa-websocket');

// const api = websockify(koa());
// const api = new Koa();
//
function notLatest(neoResult, semver) {
    return true
}

function semverToNumber(semver) {
    const numbers = semver.split('.').map(str => Number(str));
    // bit hacky, but should work except for very rare cases where semver is e.g. 23456.2.34
    const numericEquivalent = Math.pow(10, 10) * numbers[0] + Math.pow(10, 5) * numbers[1] + numbers[2];
    if (isNaN(numericEquivalent)) {
        throw 'Only x.y.z semvers supported - no supprt for prerelease semvers yet';
    }
    return numericEquivalent;
}

function getDepObject (name, range) {
    const obj = {package: name, range};
    const normalizedRange = semver.validRange(range);
    if (/\|\|/.test(range)) {
        throw 'Disjointed semver ranges not supported yet';
    }
    if (semver.valid(range)) {
        return Object.assign(obj, {
            max: semverToNumber(normalizedRange),
            min: semverToNumber(normalizedRange),
            hardMax: true,
            hardMin: true
        })
    } else {
        const rx = /\d+\.\d+\.\d+/g;
        return Object.assign(obj, {
            min: semverToNumber(rx.exec(normalizedRange)[0]),
            max: semverToNumber(rx.exec(normalizedRange)[0]),
            hardMax: normalizedRange.indexOf('<=') > -1,
            hardMin: normalizedRange.indexOf('>=') > -1
        })
    }


}

async function createTree(name, semverRange, npm) {
    npm = npm || await fetch(`https://registry.npmjs.org/${name}/${semverRange || 'latest'}?json=true`).then(res => res.json());
    const deps = npm.dependencies || {};
    return Promise.all(
        [createShallowTree(npm)]
            .concat(
                Object.keys(deps).map(name => createTree(name, [deps[name]]))
            )
    )
}

function createShallowTree(npm) {

    return db.cypher({
        query: `\
MERGE (p:Package {name: {name}})
MERGE (v:Version {semver: {semver}, numericSemver: {numericSemver}, nameVersion: {nameVersion}})
MERGE (p)-[h:hasVersion]->(v)
WITH p, v, { dependencies } AS deps
UNWIND deps AS dep
MERGE (p2:Package {name: dep.package })
MERGE (v)-[d:dependsOn]->(p2)
ON CREATE SET d += dep
RETURN p, v
`
,
        params: {
            name: npm.name,
            semver: npm.version,
            nameVersion: `${npm.name}.${npm.version}`,
            numericSemver: semverToNumber(npm.version),
            dependencies: Object.keys(npm.dependencies || {}).map(name => getDepObject(name, npm.dependencies[name]))
        },
    })
}

const apiRouter = koaRouter();

apiRouter.get('/package/:name', async (ctx, next) => {
    const npm = await fetch(`https://registry.npmjs.org/${ctx.params.name}/latest?json=true`).then(res => res.json());
    const neo = await db.cypher({
        query: `MATCH (p:Package {name: {name}})-[hasVersion]->(v) RETURN p, v`,
        params: {
            name: ctx.params.name
        },
    })

    if (!neo[0] || notLatest(neo, npm.version)) {
        ctx.body = await createTree(ctx.params.name, npm.version, npm);
    }


//     // RETURN person.Name, friend.Name
//
    // get latest version from npm   \___ race
    // get latest version from neo4j /
    // if same return neo4j
    // else send message saying getting latest version
    // create node for latest version
    // compare deps with previous version
    //

    // const dbResult = await db.cypher({
    //     query: 'MATCH (p:Package {name: {name}}) RETURN p',
    //     params: {
    //         name: ctx.params.name,
    //     },
    // }).then(results => {
    //     var result = results[0];
    //     if (!result) {
    //         return db.cypher({
    //             query: 'CREATE (p:Package {name: {name}}) RETURN p',
    //             params: {
    //                 name: ctx.params.name,
    //             },
    //         })
    //     }
    //     return results;
    // })
    //     .then(results => {
    //         const result = results[0]
    //         if(!result) {
    //             throw 'No results still!';
    //         }
    //         var pack = result['p'];
    //         console.log(JSON.stringify(pack, null, 4));
    //     });
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