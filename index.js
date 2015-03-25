var log = console.log,
  _ = require("underscore"),
  c = require('chalk'),
  logE = _.compose(log, c.bgRed.inverse),
  logS = _.compose(log, c.green),
  fs = require('fs'),
  mkd = require('mkdirp'),
  unzip = require('unzip'),
  Promise = Promise || require('bluebird'),
  resumer = require('resumer'),
  zip = require('epub-zip'),
  yaml = require('js-yaml'),
  Papa = require('babyparse'),
  glob = require('glob');

// var metadata = yaml.load(fs.readFileSync('metadata.yml', 'utf8'));
var csv = glob.sync('*.csv')[0],
  manualData = yaml.load(fs.readFileSync('metadata.yml', 'utf8')),
  fileName = glob.sync('*.epub')[0];

var metadata = csv ?
  _.extendOwn(Papa.parse(fs.readFileSync(csv, 'utf8'), {
    header: true
  }).data[0], manualData) :
  manualData;

// metadata.file = metadata.file.substr(-5) === '.epub' ?
// 	metadata.file.replace('.epub', '') :
// 	metadata.file;

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

var edit = { // Functions are composed backwards!
  xhtml_Regexes: function(doc) {
    if (metadata.regexes && metadata.regexes.xhtml &&
      metadata.regexes.xhtml.length) {
      //
    } else {
      return doc;
    }
  },
  css_Regexes: function(doc) {
    if (metadata.regexes && metadata.regexes.css &&
      metadata.regexes.css.length) {
      //
    } else {
      return doc;
    }
  },
  css_Indents: function(doc) {
    return doc
      .replace(/14px/g, '1.3em')
      .replace(/28px/g, '2.6em');
  },
  css_Test: function(doc) {
    return doc.replace(/none/g, 'WORKED!');
  },
  opf_Regexes: function(doc) {
    if (metadata.regexes && metadata.regexes.opf &&
      metadata.regexes.opf.length) {
      //
    } else {
      return doc;
    }
  },
  opf_Title: function(doc) {
    return doc.replace("<dc:title></dc:title>",
      "<dc:title>" + metadata.Title +
      (metadata.Subtitle ? (': ' + metadata.Subtitle) : '') +
      "</dc:title>");
  },
  opf_OtherContribs: function(doc) {
    var abbrevTypes = ['edt', 'ill', 'trl'],
      rawTypes = ['Editor', 'Illustrator', 'Translator'],
      verboseTypes = rawTypes.map(function(str) {
        return str + ' (First, Last)';
      }),
      res = doc;
    for (var i = 0; i < verboseTypes.length; i++) {
      if (metadata[verboseTypes[i]]) {
        res = insertAfter(res, '</dc:title>',
          '\n\t\t<dc:contributor xmlns:opf="http://www.idpf.org/2007/opf" opf:file-as="' +
          swapNames(metadata[verboseTypes[i]]) + '" opf:role="' +
          abbrevTypes[i] + '">' +
          metadata[verboseTypes[i]] +
          '</dc:contributor>'
        );
      }
    }
    return res;
  },
  opf_Author: function(doc) {
    return doc.replace("<dc:creator></dc:creator>",
      '<dc:creator xmlns:opf="http://www.idpf.org/2007/opf" opf:file-as="' +
      swapNames(metadata['Author (First, Last)']) +
      '" opf:role="aut">' +
      metadata['Author (First, Last)'] + '</dc:creator>');
  },
  opf_ISBN: function(doc) {
    if (!metadata['eBook ISBN']) {
      return doc;
    }
    return insertAfter(doc, '</dc:title>',
      '\n\t\t<dc:identifier xmlns:opf="http://www.idpf.org/2007/opf" opf:scheme="ISBN">' +
      metadata['eBook ISBN'] +
      '</dc:identifier>');
  }
};

function setUpEdit(keyStr) {
  return _.compose.apply(edit, Object.keys(edit)
    .filter(function(k) {
      return ~k.indexOf(keyStr + '_');
    }).map(function(k) {
      return edit[k];
    }));
}

edit.css = setUpEdit('css');
edit.opf = setUpEdit('opf');

fs.createReadStream(fileName)
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
          if (fileEnding !== "png" &&
            fileEnding !== "jpg" &&
            fileEnding !== "jpeg") {
            entry.setEncoding('utf8');
          }
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

  }).on('close', function() {
    try {
      var epub = zip("./out");
      fs.renameSync(fileName, 'old-' + fileName);
      fs.writeFileSync(fileName, epub);
    } catch (e) {
      logE(e);
    }
  });
