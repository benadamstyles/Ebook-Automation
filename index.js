if (!String.prototype.includes) {
  String.prototype.includes = function() {'use strict';
    return String.prototype.indexOf.apply(this, arguments) !== -1;
  };
}

var log = console.log,
  _ = require("underscore-contrib"),
  c = require('chalk'),
  logE = _.compose(log, c.bgRed.inverse),
  logS = _.compose(log, c.green),
  fs = require('fs'),
  mkd = require('mkdirp'),
  unzip = require('unzip'),
  Promise = Promise || require('bluebird'),
  resumer = require('resumer'),
  zip = require('epub-zip'),
  // yaml = require('js-yaml'),
  cson = require('cson-parser'),
  Papa = require('babyparse'),
  // rf = require('rimraf'),
  glob = require('glob');

var nodeArgs = process.argv.slice(2);

var csv = glob.sync('*.csv')[0],
    // manualData = yaml.load(fs.readFileSync('metadata.yml', 'utf8')),
    manualData = cson.parse(fs.readFileSync('metadata.cson', 'utf8')),
    srcFilePath = nodeArgs.length ? nodeArgs[0] : glob.sync('*.epub')[0],
    srcFileName = nodeArgs.length ?
      srcFilePath.substr(srcFilePath.lastIndexOf('/') + 1) :
      srcFilePath;

var metadata = csv ?
  _.extendOwn(
    Papa.parse(fs.readFileSync(csv, 'utf8'), {
      header: true
    }).data[0],
    manualData
  ) :
  manualData;

function swapNames(name) {
  var comma = name.indexOf(','),
    sep, ln, fn;
  if (~comma) {
    ln = name.substring(0, comma);
    fn = name.substring(comma + 1).trim();
    return fn + " " + ln;
  } else {
    sep = name.lastIndexOf(' ');
    fn = name.substring(0, sep);
    ln = name.substring(sep + 1).trim();
    return ln + ", " + fn;
  }
}

function insertAfter(doc, locator, str) {
  var i = doc.indexOf(locator) + locator.length;
  return doc.substr(0, i) + str + doc.substr(i, doc.length);
}

function insertBefore(doc, locator, str) {
  var i = doc.indexOf(locator);
  return doc.substr(0, i) + str + doc.substr(i, doc.length);
}

var edit = {
  xhtml_smallCaps: function(doc) {
    return doc.replace(/(?:<span class=("|')small-caps(?:[\s]*|[\s]char-style-override-\d)\1>)([^<]+)(?:<\/span>)/g,
    function(match, g1, g2, offset, str) {
      return match.replace(g2, g2.toUpperCase());
    });
  },
  xhtml_Regexes: function(doc) {
    var res = doc;
    if (metadata.regexes && metadata.regexes.xhtml &&
      metadata.regexes.xhtml.length) {
      for (var i = 0; i < metadata.regexes.xhtml.length; i++) {
        var reg = metadata.regexes.xhtml[i],
          regFind = new RegExp(reg.find, 'g');
          log(regFind);

          res = res.replace(regFind, reg.replace);
      }
    }
    return res;
  },
  css_Indents: function(doc) {
    return doc
      .replace(/14px/g, '1.3em')
      .replace(/28px/g, '2.6em')
      .replace(/43px/g,	'3.9em')
      .replace(/57px/g,	'5.2em')
      .replace(/71px/g,	'6.5em')
      .replace(/85px/g,	'7.8em')
      .replace(/99px/g,	'9.1em')
      .replace(/113px/g, '10.4em')
      .replace(/128px/g, '11.7em')
      .replace(/142px/g, '13em')
      .replace(/156px/g, '14.3em')
      .replace(/170px/g, '15.6em')
      .replace(/184px/g, '16.9em')
      .replace(/198px/g, '18.2em');

  },
  css_amzn_isbn: function(doc) {
    return doc +
      '@media amzn-mobi, amzn-kf8 {\n' +
      '\t.isbn {display: none;}\n' +
      '}';
  },
  css_Regexes: function(doc) {
    var res = doc;
    if (metadata.regexes && metadata.regexes.css &&
      metadata.regexes.css.length) {
      for (var i = 0; i < metadata.regexes.css.length; i++) {
        var reg = metadata.regexes.css[i],
          regFind = new RegExp(reg.find, 'g');
          log(regFind);

          res = res.replace(regFind, reg.replace);
      }
    }
    return res;
  },
  opf_Title: function(doc) {
    var newTitle = "<dc:title>" + metadata.Title +
      (metadata.Subtitle ? (': ' + metadata.Subtitle) : '') +
      "</dc:title>";

    if (!csv) return doc;

    if (doc.includes('<dc:title />')) {
      return doc.replace('<dc:title />', newTitle);
    } else if (doc.includes("<dc:title></dc:title>")) {
      return doc.replace("<dc:title></dc:title>", newTitle);
    } else if (!doc.includes('<dc:title>')) {
      return insertBefore(doc, '</metadata>', '\t' + newTitle + '\n\t');
    } else {
      return doc;
    }
  },
  opf_ISBN: function(doc) {
    var newISBN = '<dc:identifier xmlns:opf="http://www.idpf.org/2007/opf" opf:scheme="ISBN">' +
      metadata['eBook ISBN'] +
      '</dc:identifier>';

    if (!metadata['eBook ISBN']) return doc;
    if (!doc.includes(newISBN)) return insertBefore(doc, '</metadata>', '\t' + newISBN + '\n\t');
    else return doc;
  },
  opf_Author: function(doc) {
    var newAuthor;
    if (!csv) return doc;

    newAuthor = '<dc:creator xmlns:opf="http://www.idpf.org/2007/opf" opf:file-as="' +
    swapNames(metadata['Author (First, Last)']) +
    '" opf:role="aut">' +
    metadata['Author (First, Last)'] + '</dc:creator>';

    if (doc.includes('<dc:creator />')) {
      return doc.replace('<dc:creator />', newAuthor);
    } else if (doc.includes("<dc:creator></dc:creator>")) {
      return doc.replace("<dc:creator></dc:creator>", newAuthor);
    } else if (!doc.includes('<dc:creator>')) {
      return insertBefore(doc, '</metadata>', '\t' + newAuthor + '\n\t');
    } else {
      return doc;
    }
  },
  opf_OtherContribs: function(doc) {
    var abbrevTypes = ['edt', 'ill', 'trl'],
      rawTypes = ['Editor', 'Illustrator', 'Translator'],
      verboseTypes = rawTypes.map(function(str) {
        return str + ' (First, Last)';
      }),
      res = doc;

    if (!csv) return doc;

    for (var i = 0; i < verboseTypes.length; i++) {
      if (metadata[verboseTypes[i]]) {
        res = insertBefore(res, '</metadata>',
          '\t<dc:contributor xmlns:opf="http://www.idpf.org/2007/opf" opf:file-as="' +
          swapNames(metadata[verboseTypes[i]]) + '" opf:role="' +
          abbrevTypes[i] + '">' +
          metadata[verboseTypes[i]] +
          '</dc:contributor>' + '\n\t'
        );
      }
    }
    return res;
  },
  opf_Regexes: function(doc) {
    if (metadata.regexes && metadata.regexes.opf &&
      metadata.regexes.opf.length) {
      // TODO
      return doc;
    } else {
      return doc;
    }
  }
};

function setUpEdit(keyStr) {
  return _.pipeline(
    _.chain(edit)
      .pick(function(v, k, o) {
        return _.strContains(k, keyStr + '_');
      })
      .values().value()
  );
}

edit.css = setUpEdit('css');
edit.opf = setUpEdit('opf');
edit.xhtml = setUpEdit('xhtml');
edit.html = setUpEdit('xhtml');

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
          }).on('end', function() {
            if (edit[fileEnding]) {
              resolve(edit[fileEnding](content));
            } else {
              resolve(content);
            }
          });
        });
      };

    if (fileEnding === "png" || fileEnding === "jpg" || fileEnding === "jpeg") {
      mkd('out/' + fileDir, function(err) {
        if (!err) {
          entry.pipe(fs.createWriteStream('out/' + filePath)).on('close', function() {
            log(c.yellow('Not processed: ' + filePath));
          }).on('error', logE);
        } else {
          log(err);
        }
      });
    } else {
      run(entry).then(function(res) {
        mkd('out/' + fileDir, function(err) {
          if (!err) {
            var w = fs.createWriteStream('out/' + filePath);
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
    var epub = zip("./out");
    try {
      fs.renameSync(srcFileName, 'old-' + srcFileName);
    } catch(e) {logE(e);}
    fs.writeFileSync(srcFileName, epub);
    // if (nodeArgs[0] !== '-debug') {
    //   rf.sync("./out/META-INF", logE);
    //   rf.sync("./out/OEBPS", logE);
    //   rf.sync("./out", logE);
    // }
    logS('::: Completed in '+process.uptime()+' seconds! :::');
  } catch (e) {
    logE(e);
  }
});
