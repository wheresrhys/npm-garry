
install:
	npm install --no-spin --no-progress

run:
	source ./.env; nodemon -e js,html server -w server

build:
	@node_modules/.bin/riot --type babel client public/tags.js


watch:
	riot -w client

build-prod:
	# mkdir public 2>/dev/null
	# nunjucks-precompile ./webapp > ./public/templates.js
	# export PRODUCTION_BUILD=true; webpack;
	# node-sass webapp/main.scss -o public
	# cp abcjs/bin/abcjs_basic_2.3-min.js public/abc.js
	# cp webapp/favicon.ico public/favicon.ico
	# cp -rf webapp/img public/img

deploy:
	# Package+deploy
	@haikro build
	@haikro deploy --app npm-garry --commit `git rev-parse HEAD`