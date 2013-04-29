var childProcess = require('child_process'),
    Stream = require('stream').Stream,
    util = require('util'),
    fs = require('fs'),
    getTemporaryFilePath = require('gettemporaryfilepath');

function Inkscape(inkscapeArgs) {
    Stream.call(this);

    this.inkscapeArgs = inkscapeArgs || [];

    this.inkscapeArgs.push('--without-gui');

    this.writable = this.readable = true;

    for (var i = 0 ; i < this.inkscapeArgs.length ; i += 1) {
        var matchInkscapeArg = this.inkscapeArgs[i].match(/^(-e|-P|-E|-A|-l|--export-(?:plain-svg|png|ps|eps|pdf))(?:=|$)$/);
        if (matchInkscapeArg) {
            if (matchInkscapeArg[1] === '-e' || matchInkscapeArg[1] === '--export-png') {
                this.outputFormat = 'png';
            } else if (matchInkscapeArg[1] === '-A' || matchInkscapeArg[1] === '--export-pdf') {
                this.outputFormat = 'pdf';
            } else if (matchInkscapeArg[1] === '-E' || matchInkscapeArg[1] === '--export-eps') {
                this.outputFormat = 'eps';
            } else if (matchInkscapeArg[1] === '-P' || matchInkscapeArg[1] === '--export-ps') {
                this.outputFormat = 'ps';
            } else if (matchInkscapeArg[1] === '-l' || matchInkscapeArg[1] === '--export-plain-svg') {
                this.outputFormat = 'svg';
            } else {
                throw new Error('Internal error: Unable to parse export switch: ' + inkscapeArg);
            }

            this.inkscapeOutputFilePath = getTemporaryFilePath({suffix: '.' + this.outputFormat}),

            this.inkscapeArgs[i] = '--export-' + (this.outputFormat === 'svg' ? 'plain-' : '') + this.outputFormat + '=' + this.inkscapeOutputFilePath;
            break;
        }
    }

    if (!this.outputFormat) {
        this.outputFormat = 'png';
        this.inkscapeOutputFilePath = getTemporaryFilePath({suffix: '.' + this.outputFormat}),
        this.inkscapeArgs.push('-e=' + this.inkscapeOutputFilePath);
    }

    this.inkscapeInputFilePath = getTemporaryFilePath({suffix: '.svg'});

    this.inkscapeArgs.push(this.inkscapeInputFilePath);

    this.writeStream = fs.createWriteStream(this.inkscapeInputFilePath);
    this.writeStream.on('error', function (err) {
        this.emit('error', err);
    }.bind(this));
}

util.inherits(Inkscape, Stream);

Inkscape.prototype.write = function (chunk) {
    this.writeStream.write(chunk);
};

Inkscape.prototype.end = function (chunk) {
    if (chunk) {
        this.write(chunk);
    }
    this.writeStream.end();
    this.writable = false;
    this.writeStream.on('close', function () {
        var inkscapeProcess = childProcess.spawn('inkscape', this.inkscapeArgs),
            stdoutChunks = [];

        inkscapeProcess.stdout.on('data', function (chunk) {
            stdoutChunks.push(chunk);
        });

        inkscapeProcess.on('exit', function (exitCode) {
            if (exitCode > 0) {
                return this.emit('error', new Error('The inkscape process exited with a non-zero exit code: ' + exitCode));
            }
            fs.unlink(this.inkscapeInputFilePath, function (err) {
                if (err) {
                    console.error(err.stack);
                }
            });
            fs.stat(this.inkscapeOutputFilePath, function (err, stats) {
                if (err) {
                    return this.emit('error', new Error('inkscape did not write an output file, stdout output:\n' + Buffer.concat(stdoutChunks).toString('ascii')));
                }
                this.readStream = fs.createReadStream(this.inkscapeOutputFilePath);
                if (this.isPaused) {
                    this.readStream.pause();
                }
                this.readStream.on('data', function (chunk) {
                    this.emit('data', chunk);
                }.bind(this));
                this.readStream.on('end', function () {
                    fs.unlink(this.inkscapeOutputFilePath, function (err) {
                        if (err) {
                            console.error(err.stack);
                        }
                    });
                    this.emit('end');
                }.bind(this));
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

// Proxy pause and resume to the underlying readStream if it has been
// created, otherwise just keep track of the paused state:
Inkscape.prototype.pause = function () {
    this.isPaused = true;
    if (this.readStream) {
        this.readStream.pause();
    }
};

Inkscape.prototype.resume = function () {
    this.isPaused = false;
    if (this.readStream) {
        this.readStream.resume();
    }
};

module.exports = Inkscape;
