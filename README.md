node-inkscape
=============

[![NPM version](https://badge.fury.io/js/inkscape.svg)](http://badge.fury.io/js/inkscape)
[![Build Status](https://travis-ci.org/papandreou/node-inkscape.svg?branch=master)](https://travis-ci.org/papandreou/node-inkscape)
[![Coverage Status](https://coveralls.io/repos/papandreou/node-inkscape/badge.svg)](https://coveralls.io/r/papandreou/node-inkscape)
[![Dependency Status](https://david-dm.org/papandreou/node-inkscape.svg)](https://david-dm.org/papandreou/node-inkscape)

The inkscape command line utility as a readable/writable stream. This
is handy for situations where you don't want to worry about writing
the input to disc and reading the output afterwards.

The constructor optionally takes an array of command line options for
the `inkscape` binary:

```javascript
var Inkscape = require('inkscape'),
    svgToPdfConverter = new Inkscape(['--export-pdf', '--export-width=1024']);

sourceStream.pipe(svgToPdfConverter).pipe(destinationStream);
```

Import type can also be fed to the constructor (converting PDF to PNG):

```javascript
var Inkscape = require('inkscape'),
    pdfToPngConverter = new Inkscape(['--export-png', '--export-width=1024', '--import-pdf']);

sourceStream.pipe(pdfToPngConverter).pipe(destinationStream);
```

Inkscape as a web service (converts to a PNG):

```javascript
var Inkscape = require('inkscape'),
    http = require('http');

http.createServer(function (req, res) {
    if (req.headers['content-type'] === 'image/svg') {
        res.writeHead(200, {'Content-Type': 'image/png'});
        req.pipe(new Inkscape(['-e'])).pipe(res);
    } else {
        res.writeHead(400);
        res.end('Feed me an SVG!');
    }
}).listen(1337);
```

Installation
------------

Make sure you have node.js and npm installed, and that the `inkscape` binary is in your PATH, then run:

    npm install inkscape

License
-------

3-clause BSD license -- see the `LICENSE` file for details.
