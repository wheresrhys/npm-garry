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
	console.log(normalizedRange);
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
		const firstSemver = (rx.exec(normalizedRange) || [])[0];
		const secondSemver = (rx.exec(normalizedRange) || [])[0];
		if (firstSemver && secondSemver) {
			return Object.assign(obj, {
				min: semverToNumber(firstSemver),
				max: semverToNumber(secondSemver),
				hardMax: normalizedRange.indexOf('<=') > -1,
				hardMin: normalizedRange.indexOf('>=') > -1
			})
		} else {
			if (normalizedRange.indexOf('<') > -1) {
				return Object.assign(obj, {
					max: semverToNumber(firstSemver),
					hardMax: normalizedRange.indexOf('<=') > -1
				})
			} else {
				return Object.assign(obj, {
					min: semverToNumber(firstSemver),
					hardMin: normalizedRange.indexOf('>=') > -1
				})
			}
		}
	}


}

async function createTree(name, semverRange, npm) {

	npm = npm || await fetch(`https://registry.npmjs.org/${name}/${semverRange || 'latest'}?json=true`).then(res => res.json());
	let newData;
	if (npm.dependencies) {
		newData = Promise.all([createShallowTree(npm)]
			.concat(Object.keys(npm.dependencies).map(name => createTree(name, [npm.dependencies[name]]))));
	} else {
		newData = Promise.resolve([createShallowTree(npm)]);
	}
	return Promise.race([
		readTree(name, npm.version),
		newData
	])
}


function createShallowTree(npm) {
	// TODO write updated date
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
RETURN p as package, v as version, d as dependency
`,
		params: {
			name: npm.name,
			semver: npm.version,
			nameVersion: `${npm.name}.${npm.version}`,
			numericSemver: semverToNumber(npm.version),
			dependencies: Object.keys(npm.dependencies || {}).map(name => getDepObject(name, npm.dependencies[name]))
		},
	})
}

function readTree(name, version) {
	return readShallowTree(name, version)
// 	return db.cypher({
// 		query: `\
// MATCH path=(p:Package {name: {name}})-[h:hasVersion]->(Version {semver: {semver}})-[*0..]->(node)
// RETURN node, length(path) AS depth
// `,
// 		params: {
// 			name: name,
// 			semver: version
// 		},
// 	}).then(json => JSON.stringify(json, null, 2))
}

function readShallowTree(name, version) {
	// TODO write updated date
	return db.cypher({
		query: `\
MATCH (p:Package {name: {name}})-[:hasVersion]->(v:Version {semver: {semver}})-[d:dependsOn]->(dep:Package)-[:hasVersion]->(depV:Version)
WHERE depV.numericSemver <= d.max AND depV.numericSemver >= d.min
RETURN p as package, v as version, d as dependency, dep, depV
ORDER BY depV.numericSemver DESC
	LIMIT 1
`,
		params: {
			name: name,
			semver: version
		},
	})
}


const apiRouter = koaRouter();

apiRouter.get('/package/:name', async (ctx, next) => {

	const [npm, neo] = await Promise.all([
		fetch(`https://registry.npmjs.org/${ctx.params.name}/latest?json=true`).then(res => res.json()),
		db.cypher({
			query: `MATCH (p:Package {name: {name}})-[hasVersion]->(v) RETURN v`,
			params: {
				name: ctx.params.name
			},
		})
	])

	if (npm.error) {
		throw 'not a valid package name'
	}

	if (!neo[0] || notLatest(neo, npm.version)) {
		ctx.body = await createTree(ctx.params.name, npm.version, npm);
	} else {
		// TODO if date created not recent refresh in background
		ctx.body = await readTree(ctx.params.name, npm.version);
	}

	//TODO
	//Socket the hell out of it

  next();
})


module.exports = apiRouter;