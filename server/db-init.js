const neo4j = require('neo4j');


function getDb () {
	const db = new neo4j.GraphDatabase(process.env.GRAPHENEDB_URL);

	let cypher = db.cypher;
	db.cypher = function(opts) {
		return new Promise((resolve, reject) => {
			cypher.call(db, opts, (err, results) => {
				if (err) {
					console.warn({ event: 'DB_ERROR', error: err.toString() });
					reject(err);
					return;
				}
				resolve(results);
			});
		});
	};
	return db;
}


class Model {
	constructor(opts) {
		this.type = opts.type;
		this.indexOn = opts.indexOn,
		this.relationships = opts.relationships || [];
		this.schema = opts.schema || {};
		this.setConstraints();
	}

	setConstraints () {
		this.constraints = {};
		Object.keys(this.schema).forEach(key => {
			if (this.schema[key].uniqueForUser) {
				this.constraints.uniqueForUser = key;
			}
		});
	}

	hasRelationship(label, type) {
		return this.relationships.some(rel => {
			return type ? (rel.label === label && rel.model.toLowerCase() === type) : (rel.label === label);
		});
	}

	getRelationship(label, type) {
		return this.relationships.find(rel => {
			return rel.label === label && rel.model.toLowerCase() === type;
		});
	}
}


const Package = new Model({
	type: 'Package',
	indexOn: 'name',
	schema: {
		name: {
			type: String,
			required: true
		}
	},
	relationships: [
		{
			label: 'hasVersion',
			model: 'Version',
			many: true
		}
	]
});

const Version = new Model({
	type: 'Version',
	indexOn: 'nameVersion',
	schema: {
		nameVersion: {
			type: String,
			required: true
		},
		semver: {
			type: String,
			required: true
		},
		numericSemver: {
			type: Number,
			required: true
		}
	},
	relationships: [
		{
			label: 'hasDependency',
			model: 'Package',
			many: true
		}
	]
});

const Dependency = new Model({
	type: 'Dependency',

	schema: {
		range: {
			type: String,
			required: true
		},
		max: {
			type: Number, // convert e.g. 1.2.3 => 00000000100000000002000000003
			required: true
		},
		min: {
			type: Number, // convert e.g. 1.2.3 => 00000000100000000002000000003
			required: true
		},
		hardMax: {
			type: Boolean,
			required: true
		},
		hardMin: {
			type: Boolean,
			required: true
		}
	},
	relationships: [
		{
			label: 'isForPackage',
			model: 'Package',
			many: true
		}
	]
});

const directly = require('directly');
const models = {
	Package,
	Version,
	Dependency
}

let retryCount = 0;

function createConstraint(label, indexOn) {
	return new Promise((resolve, reject) => {
		console.log('promising to return for ', label);
		const query = `CREATE CONSTRAINT ON (actor:${label}) ASSERT actor.${indexOn} IS UNIQUE`;
		console.log(query);
		getDb().cypher({query}).then(resp => {
			console.log('created constraint for ', label);
			resolve(resp);
		}).catch(err => {
			console.log('error creating constraint for ', label);
			if(retryCount++ < 5) {
				console.log('retrying...');
				createConstraint(label, indexOn);
			} else {
				console.log('rejecting');
				reject(err);
			}
		});
	});
}

function init() {
	return directly(1, Object.keys(models).filter(m => models[m].indexOn).map(m => () => createConstraint(models[m].type, models[m].indexOn)))
		.then(() => console.log("All done creating constraints!"))
}

module.exports = Object.assign({ init , getDb}, models);