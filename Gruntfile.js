'use strict';

var moment = require('moment');
var util = require('util');

module.exports = function (grunt) {
	var files = [
		'logger.js',
		'helpers/**/*.js',
		'modules/*.js',
		'logic/*.js',
		'schema/**/*.js',
		'sql/**/*.js',
		'app.js'
	];

	var today = moment().format('HH:mm:ss DD/MM/YYYY');

	var config = require('./config.json');

	var release_dir = __dirname + '/release/',
	    version_dir = release_dir + config.version;

	grunt.initConfig({
		obfuscator: {
			files: files,
			entry: 'app.js',
			out: 'release/app.js',
			strings: true,
			root: __dirname
		},

		exec: {
			package: {
				command: function () {
					return [
						util.format('mkdir -p %s', version_dir),
						util.format('mkdir -p %s/logs', version_dir),
						util.format('mkdir -p %s/pids', version_dir),
						util.format('cp %s/app.js %s', release_dir, version_dir),
						util.format('cp %s/config.json %s', __dirname, version_dir),
						util.format('cp %s/package.json %s', __dirname, version_dir),
						util.format('cp %s/genesisBlock.json %s', __dirname, version_dir),
						util.format('mkdir -p %s/sql/migrations', version_dir),
						util.format('cp %s/sql/*.sql %s/sql/', __dirname, version_dir),
						util.format('cp %s/sql/migrations/*.sql %s/sql/migrations/', __dirname, version_dir)
					].join(' && ');
				}
			},
			folder: {
				command: 'mkdir -p ' + release_dir
			},
			build: {
				command: 'cd ' + version_dir + '/ && touch build && echo "v' + today + '" > build'
			}
		},

		compress: {
			main: {
				options: {
					archive: version_dir + '.tar.gz',
					mode: 'tgz',
					level: 6
				},
				files: [
					{ expand: true, cwd: release_dir, src: [config.version + '/**'], dest: './' }
				]
			}
		},

		jsdox: {
			generate: {
				src: [
					'helpers/*.js'
					// './modules/*.js'
				],
				dest: 'tmp/docs',
				options: {
					templateDir: 'var/jsdox'
				}
			}
		},

		jshint: {
			options: {
				jshintrc: true
			},
			all: [
				'*.js',
				'helpers/**/*.js',
				'modules/**/*.js',
				'logic/**/*.js',
				'schema/**/*.js',
				'sql/**/*.js',
				'tasks/**/*.js',
				'test/*.js',
				'test/api/**/*.js',
				'test/unit/**/*.js'
			]
		},

		mochaTest: {
			test: {
				options: {
					reporter: 'spec',
					quiet: false,
					clearRequireCache: false,
					noFail: false,
					timeout: '250s'
				},
				src: ['test']
			}
		}
	});

	grunt.loadTasks('tasks');

	grunt.loadNpmTasks('grunt-obfuscator');
	grunt.loadNpmTasks('grunt-jsdox');
	grunt.loadNpmTasks('grunt-exec');
	grunt.loadNpmTasks('grunt-contrib-compress');
	grunt.loadNpmTasks('grunt-contrib-jshint');
	grunt.loadNpmTasks('grunt-mocha-test');

	grunt.registerTask('default', ['release']);
	grunt.registerTask('release', ['exec:folder', 'obfuscator', 'exec:package', 'exec:build', 'compress']);
	grunt.registerTask('travis', ['jshint', 'mochaTest']);
};
