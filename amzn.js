if (!Array.prototype.find) {
  Array.prototype.find = function(predicate) {
    if (this == null) {
      throw new TypeError('Array.prototype.find called on null or undefined');
    }
    if (typeof predicate !== 'function') {
      throw new TypeError('predicate must be a function');
    }
    var list = Object(this);
    var length = list.length >>> 0;
    var thisArg = arguments[1];
    var value;

    for (var i = 0; i < length; i++) {
      value = list[i];
      if (predicate.call(thisArg, value, i, list)) {
        return value;
      }
    }
    return undefined;
  };
}

var log = console.log,
  _ = require("underscore"),
  c = require('chalk'),
  logE = _.compose(log, c.bgRed.inverse),
  logS = _.compose(log, c.yellow),
  fs = require('fs'),
  mkd = require('mkdirp'),
  unzip = require('unzip'),
  Promise = Promise || require('bluebird'),
  resumer = require('resumer'),
  zip = require('epub-zip'),
  // yaml = require('js-yaml'),
  cson = require('cson-parser'),
  Papa = require('babyparse'),
  glob = require('glob'),
  exec = require('execsyncs');

var nodeArgs = process.argv.slice(2);

// var metadata = yaml.load(fs.readFileSync('metadata.yml', 'utf8'));
var metadata = cson.parse(fs.readFileSync('metadata.cson', 'utf8'));
var srcFilePath = nodeArgs.length ?
      nodeArgs[0] :
      glob.sync('*.epub').find(function(name) {
        return name.substr(0, 4) !== 'old-';
      }),
    srcFileName = nodeArgs.length ?
      srcFilePath.substr(srcFilePath.lastIndexOf('/') + 1) :
      srcFilePath;

function insertAfter(doc, locator, str) {
  var i = doc.indexOf(locator) + locator.length;
  return doc.substr(0, i) + str + doc.substr(i, doc.length);
}

function insertBefore(doc, locator, str) {
  var i = doc.indexOf(locator);
  return doc.substr(0, i) + str + doc.substr(i, doc.length);
}

function edit(doc) {
  return insertAfter(doc, '</spine>',
    '\n' +
    '\t<guide>\n' +
    '\t\t<reference href="Text/' + metadata.toc_file + '#' + metadata
    .toc_id +
    '" title="Table of Contents" type="toc" />\n' +
    '\t\t<reference href="Images/cover.jpg" type="cover" />\n' +
    '\t\t<reference href="Text/' + metadata.start_reading_file +
    '#' + (metadata.start_reading_id || 'full-title') +
    '" title="Start Reading" type="text" />\n' +
    '\t</guide>'
  );
}

fs.createReadStream(srcFilePath)
  .pipe(unzip.Parse())
  .on('entry', function(entry) {
    var filePath = entry.path,
      fileEnding = filePath.substring(filePath.lastIndexOf('.') + 1),
      folderSep = ~filePath.indexOf('/') ? '/' : '\\',
      fileDir = filePath.substr(0, filePath.length - fileEnding.length)
      .substring(0, filePath.lastIndexOf(folderSep) + 1),
      run = function(entry) {
        return new Promise(function(resolve, reject) {
          var content = '';
          entry.setEncoding('utf8');
          entry.on('data', function(data) {
              content += data;
            })
            .on('end', function() {
              resolve(fileEnding === 'opf' ?
                edit(content) :
                content
              );
            });
        });
      };

    if (fileEnding === "png" || fileEnding === "jpg" || fileEnding === "jpeg") {
      mkd('amzn/' + fileDir, function(err) {
        if (!err) {
          entry.pipe(fs.createWriteStream('amzn/' + filePath)).on('close', function() {
            logS('Processed ' + filePath);
          }).on('error', logE);
        } else {
          log(err);
        }
      });
    } else {
      run(entry).then(function(res) {
        mkd('amzn/' + fileDir, function(err) {
          if (!err) {
            var w = fs.createWriteStream('amzn/' + filePath);
            w.on('open', function() {
              w.write(res);
              logS('Processed ' + filePath);
            }).on('error', logE);
          } else {
            log(err);
          }
        });
      }).catch(log);
    }
  });

process.on('exit', function() {
  try {
    var epub = zip("./amzn"),
        newFileName = insertBefore(srcFileName, '.epub', '-amzn');
    fs.writeFileSync(newFileName, epub);
    log(exec('./kindlegen ' + newFileName));
    logS('::: Completed in '+process.uptime()+' seconds! :::');
  } catch (e) {
    logE(e);
  }
});
