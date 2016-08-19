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
			closedMax: true,
			closedMin: true
		})
	} else if (range === '*') {
		return Object.assign(obj, {
			max: 0,
			min: semverToNumber('9999999.9.9'),
			closedMax: true,
			closedMin: true
		})
	} else {
		const rx = /\d+\.\d+\.\d+/g;
		const firstSemver = (rx.exec(normalizedRange) || [])[0];
		const secondSemver = (rx.exec(normalizedRange) || [])[0];
		if (firstSemver && secondSemver) {
			return Object.assign(obj, {
				min: semverToNumber(firstSemver),
				max: semverToNumber(secondSemver),
				closedMax: normalizedRange.indexOf('<=') > -1,
				closedMin: normalizedRange.indexOf('>=') > -1
			})
		} else {
			if (normalizedRange.indexOf('<') > -1) {
				return Object.assign(obj, {
					min: 0,
					closedMin: true,
					max: semverToNumber(firstSemver),
					closedMax: normalizedRange.indexOf('<=') > -1
				})
			} else {
				return Object.assign(obj, {
					max: semverToNumber('9999999.9.9'),
					closedMax: true,
					min: semverToNumber(firstSemver),
					closedMin: normalizedRange.indexOf('>=') > -1
				})
			}
		}
	}


}


function mergeTree (tree, subtrees) {
	subtrees.forEach(subtree => {
		tree[subtree.name] = Object.assign(subtree, tree[subtree.name]);
	})
	return tree;
}

async function getTree(opts) {

	const packageJson = opts.packageJson || await fetch(`https://registry.npmjs.org/${opts.name}/${opts.semverRange || 'latest'}?json=true`).then(res => res.json());

	// TODO if created ages ago then fire off a createShallow Tree in the background
	let tree = await readShallowTree(opts.name, packageJson.version)
		.catch( _ => createShallowTree(packageJson))

	if (packageJson.dependencies) {
		const subtrees = await Promise.all(
			Object.keys(packageJson.dependencies)
				.map(name => getTree({
					name,
					semverRange: packageJson.dependencies[name]
				}))
		);
		tree = mergeTree(tree, subtrees);
	}
	return {
		name: opts.name,
		version: packageJson.version,
		range: opts.semverRange,
		dependencies: tree
	}
}

function processRawData(res) {
	const packages = {};
	res
		.map(r => {
			return {
				name: r.dep.properties.name,
				version: r.depV.properties.semver,
				range: r.dependency.properties.range
			}
		})
		.forEach(item => {
			if (!packages[item.name]) {
				packages[item.name] = item;
			}
		})
	return packages;
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
		.then(processRawData)
}

function readShallowTree(name, version) {
	// TODO write updated date
	return db.cypher({
		query: `\
MATCH (p:Package {name: {name}})-[:hasVersion]->(v:Version {semver: {semver}})-[d:dependsOn]->(dep:Package)-[:hasVersion]->(depV:Version)
WHERE ((d.closedMax AND depV.numericSemver <= d.max) OR depV.numericSemver < d.max) AND ((d.closedMin AND depV.numericSemver >= d.min) OR depV.numericSemver > d.min)
RETURN d as dependency, dep, depV
ORDER BY dep.name, depV.numericSemver DESC
`,
		params: {
			name: name,
			semver: version
		},
	})
		.then(processRawData)
}

const apiRouter = koaRouter();

apiRouter.get('/package/:name', async (ctx, next) => {

	const npm = await fetch(`https://registry.npmjs.org/${ctx.params.name}/latest?json=true`).then(res => res.json());
	console.log(npm)
	if (npm.error) {
		throw 'not a valid package name'
	}

	ctx.body = await getTree({
		name: ctx.params.name,
		semverRange: npm.version,
		packageJson: npm
	});

	//TODO
	//Socket the hell out of it

  next();
})


module.exports = apiRouter;