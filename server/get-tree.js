import {init as initNeo, getDb as getNeo} from './neo4j-init';
import semver from 'semver';
import { createClient } from 'then-redis'


const redis = createClient(process.env.HEROKU_REDIS_ONYX_URL)

initNeo();
const neo4j = getNeo();


function semverToNumber(semver) {
	const numbers = semver.split('.').map(str => Number(str));
	// bit hacky, but should work except for very rare cases where semver is e.g. 23456.2.34
	const numericEquivalent = Math.pow(10, 10) * numbers[0] + Math.pow(10, 5) * numbers[1] + numbers[2];
	if (isNaN(numericEquivalent)) {
		// not throwing fro now as only used in neo4j
		return -1;
		throw 'Only x.y.z semvers supported - no supprt for prerelease semvers yet';
	}
	return numericEquivalent;
}

function getDepObject (name, range) {
	const obj = {package: name, range};
	const normalizedRange = semver.validRange(range);
	if (/\|\|/.test(range)) {
		return null
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
		tree[subtree.name] = Object.assign(tree[subtree.name], subtree);
	})
	return tree;
}



function processRawData(res) {
	const packages = {};
	res
		.map(r => {
			return {
				name: r.dependencyPackage.properties.name,
				version: r.dependencyVersion && r.dependencyVersion.properties.semver,
				range: r.dependencyRelationship.properties.range
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

	neo4j.cypher({
		query: `\
MERGE (p:Package {name: {name}})
SET p.updated = {updated}
MERGE (v:Version {semver: {semver}, numericSemver: {numericSemver}, nameVersion: {nameVersion}})
MERGE (p)-[h:hasVersion]->(v)
WITH p, v, { dependencies } AS deps
UNWIND deps AS dep
MERGE (p2:Package {name: dep.package })
MERGE (v)-[d:dependsOn]->(p2)
ON CREATE SET d += dep
RETURN p as package, v as version, d as dependencyRelationship, p2 as dependencyPackage
`,
		params: {
			name: npm.name,
			updated: new Date().toISOString(),
			semver: npm.version,
			nameVersion: `${npm.name}.${npm.version}`,
			numericSemver: semverToNumber(npm.version) || -1,
			dependencies: Object.keys(npm.dependencies || {}).map(name => getDepObject(name, npm.dependencies[name]))
				// as neo4j not used for now, ignoring and not throwing on weird semvers like `1 || 2`
				.filter(obj => !!obj)
		},
	})
		.then(processRawData)

	// for now don't wait for neo4j, and just return something obtained from package json
	return npm.dependencies ? Promise.resolve(Object.keys(npm.dependencies).reduce((obj, key) => {
		obj[key] = {
			name: key,
			range: npm.dependencies[key],
			dependencies: {}
		}
		return obj;
	}, {})) : Promise.resolve({});
}

function readShallowTree(name, version) {
	// TODO write updated date
	return neo4j.cypher({
		query: `\
MATCH (p:Package {name: {name}})-[:hasVersion]->(v:Version {semver: {semver}})-[d:dependsOn]->(p2:Package)-[:hasVersion]->(depV:Version)
WHERE ((d.closedMax AND depV.numericSemver <= d.max) OR depV.numericSemver < d.max) AND ((d.closedMin AND depV.numericSemver >= d.min) OR depV.numericSemver > d.min)
RETURN p as package, v as version, d as dependencyRelationship, p2 as dependencyPackage, depV AS dependencyVersion
ORDER BY dependencyPackage.name, dependencyVersion.numericSemver DESC
`,
		params: {
			name: name,
			semver: version
		},
	})
		.then(records => {
			if (!records.length) {
				throw 'no results';
			}
			if (!records[0].package.updated || (new Date() - new Date(records[0].package.updated)) > (1000 * 60 * 60 * 24)) {
				throw 'record too old';
			}
			return records;
		})
		.then(processRawData)
}


async function getTree(opts) {
	const packageJson = opts.packageJson || await fetch(`https://registry.npmjs.org/${opts.name.replace('/', '%2F')}/${opts.semverRange || 'latest'}?json=true`).then(res => res.json());

	// TODO if created ages ago then fire off a createShallow Tree in the background

	// try redis
	// then try graphdb, but reject if too old
	// then try npm
	const tree = {};

	const result = {
		name: opts.name,
		version: packageJson.version,
		range: opts.semverRange,
		dependencies: tree,
		complete: false
	}

	const redisKey = `${opts.name}:${packageJson.version}`;
	// For now don't read from neo4j - it's slow and not useful for this task
	// const complete = readShallowTree(opts.name, packageJson.version)
	// 	.catch( _ => createShallowTree(packageJson))
	const complete = redis.get(redisKey)
		.then(redisResult => {
			if (!redisResult) {
				throw 'not in redis';
			}
			Object.assign(result, JSON.parse(redisResult))
			opts.channel.update()
		})
		.catch(() => {
			return createShallowTree(packageJson)
				.then(directDependencies => {
					Object.assign(tree, directDependencies);
					if (packageJson.dependencies) {
						return Promise.all(Object.keys(packageJson.dependencies)
							.map(name => getTree({
									name,
									semverRange: packageJson.dependencies[name],
									channel: opts.channel
								})
								.then(([subtree, complete]) => {
									mergeTree(tree, [subtree]);
									opts.channel.update();
									complete.then(() => {
										tree[subtree.name].complete = true;
									})
									return complete;
								})
							))
					}
				}).then(() => {
					result.complete = true;
					opts.channel.update();
					// There's a max string length of 512MB, so won't always work, but as we build responses recursively, no harnm ins always trying
					redis
						.set(redisKey, JSON.stringify(result))
						.then(() => redis.expireat(redisKey, parseInt((+new Date)/1000) + 86400))
				});
		})




	// Also TODO - the result of every getTree call should be cached (REDIS?) and if readShallowTree succeeds just grab the whole thing from cache

	return [result, complete]
}

module.exports = getTree;
