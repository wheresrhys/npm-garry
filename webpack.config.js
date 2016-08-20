// TODO include abcjs in the bundle
module.exports = {
	context: __dirname,
	entry: "./client/main.js",
	output: {
			path: __dirname + "/public",
			filename: "main.js"
	},
	devtool: 'sourcemap',
	module: {
		loaders: [
			{
				test: /\.js$/,
				exclude: /node_modules/,
				loader: 'babel',
				query: {
					plugins: [
						'transform-es2015-modules-commonjs',
						'transform-async-to-generator',
						["transform-react-jsx", { "pragma":"h" }]
					]
				}
			}
		]
	}
}