var log = console.log,
	fs = require('fs'),
	mkd = require('mkdirp'),
	unzip = require('unzip'),
	Promise = Promise || require('bluebird'),
	resumer = require('resumer'),
	c = require('chalk'),
	_ = require("underscore"),
	zip = require('epub-zip'),
	yaml = require('js-yaml');

var metadata = yaml.load(fs.readFileSync('metadata.yml', 'utf8'));

function swapNames(name) {
	var sep = name.indexOf(','),
		ln = name.substring(0, sep),
		fn = name.substring(sep + 1)
		.trim();
	return fn + " " + ln;
}

var edit = {
	css_Indents: function(doc) {
		return doc
			.replace(/14px/g, '1.3em')
			.replace(/28px/g, '2.6em');
	},
	css_Test: function(doc) {
		return doc.replace(/none/g, 'WORKED!');
	},
	opf_Title: function(doc) {
		return doc.replace("<dc:title></dc:title>",
			"<dc:title>" + metadata.title + "</dc:title>");
	},
	opf_Author: function(doc) {
		return doc.replace("<dc:creator></dc:creator>",
			'<dc:creator xmlns:opf="http://www.idpf.org/2007/opf" opf:file-as="' +
			metadata.author +
			'" opf:role="aut">' +
			swapNames(metadata.author) + '</dc:creator>');
	},
	opf_ISBN: function(doc) {
		return doc;
	}
};

function setUpEdit(keyStr) {
	return _.compose.apply(edit, Object.keys(edit)
		.filter(function(k) {
			return ~k.indexOf(keyStr + '_');
		})
		.map(function(k) {
			return edit[k];
		}));
}

edit.css = setUpEdit('css');
edit.opf = setUpEdit('opf');

fs.createReadStream('test2.epub')
	.pipe(unzip.Parse())
	.on('entry', function(entry) {
		var fileName = entry.path,
			fileEnding = fileName.substring(fileName.lastIndexOf('.') + 1),
			fileDir = fileName.substr(0, fileName.length - fileEnding.length)
			.substring(0, fileName.lastIndexOf('/') + 1),
			changed = false,
			run = function(entry) {
				return new Promise(function(resolve, reject) {
					var content = '';
					if (fileEnding !== "png" &&
						fileEnding !== "jpg" &&
						fileEnding !== "jpeg") {
						entry.setEncoding('utf8');
					}
					entry.on('data', function(data) {
							content += data;
						})
						.on('end', function() {
							if (edit[fileEnding]) {
								resolve(edit[fileEnding](content));
							} else {
								resolve(content);
							}
						});
				});
			};

		run(entry)
			.then(function(res) {
				mkd('out/' + fileDir, function(err) {
					if (!err) {
						var w = fs.createWriteStream('out/' + fileName);
						w.on('open', function() {
								w.write(res);
								log(c.green('Processed ' + fileName));
							})
							.on('error', function(error) {
								console.trace(c.red(error));
							});
					} else {
						log(err);
					}
				});
			})
			.catch(log);
	})
	.on('close', function() {
		try {
			var epub = zip("./out");
			fs.writeFileSync("out.epub", epub);
		} catch (e) {
			log(c.bgRed.inverse(e));
		}
	});
