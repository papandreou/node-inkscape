var childProcess = require('child_process'),
    Stream = require('stream').Stream,
    util = require('util'),
    fs = require('fs'),
    getTemporaryFilePath = require('gettemporaryfilepath'),
    async = require('async');

function Inkscape(inkscapeArgs) {
    Stream.call(this);

    this.inkscapeArgs = inkscapeArgs || [];

    this.inkscapeArgs.push('--without-gui');
    this.inkscapeArgs.push('--export-text-to-path');

    this.writable = true;
    this.readable = true;

    this.hasEnded = false;

    this.filesToCleanUp = [];

    for (var i = 0 ; i < this.inkscapeArgs.length ; i += 1) {
        var matchInkscapeArg = this.inkscapeArgs[i].match(/^(-e|-P|-E|-A|-l|--export-(?:plain-svg|png|ps|eps|pdf))(?:=|$)$/);
        if (matchInkscapeArg) {
            var inkscapeArg = matchInkscapeArg[1];
            if (inkscapeArg === '-e' || inkscapeArg === '--export-png') {
                this.outputFormat = 'png';
            } else if (inkscapeArg === '-A' || inkscapeArg === '--export-pdf') {
                this.outputFormat = 'pdf';
            } else if (inkscapeArg === '-E' || inkscapeArg === '--export-eps') {
                this.outputFormat = 'eps';
            } else if (inkscapeArg === '-P' || inkscapeArg === '--export-ps') {
                this.outputFormat = 'ps';
            } else if (inkscapeArg === '-l' || inkscapeArg === '--export-plain-svg') {
                this.outputFormat = 'svg';
            } else {
                throw new Error('Internal error: Unable to parse export switch: ' + inkscapeArg);
            }

            this.inkscapeOutputFilePath = getTemporaryFilePath({suffix: '.' + this.outputFormat});

            this.inkscapeArgs[i] = '--export-' + (this.outputFormat === 'svg' ? 'plain-' : '') + this.outputFormat + '=' + this.inkscapeOutputFilePath;
            break;
        }
    }

    if (!this.outputFormat) {
        this.outputFormat = 'png';
        this.inkscapeOutputFilePath = getTemporaryFilePath({suffix: '.' + this.outputFormat});
        this.inkscapeArgs.push('-e=' + this.inkscapeOutputFilePath);
    }

    this.filesToCleanUp.push(this.inkscapeOutputFilePath);

    this.inkscapeInputFilePath = getTemporaryFilePath({suffix: '.svg'});

    this.inkscapeArgs.push(this.inkscapeInputFilePath);
}

util.inherits(Inkscape, Stream);

Inkscape.prototype._error = function (err) {
    if (!this.hasEnded) {
        this.hasEnded = true;
        this.cleanUp();
        this.emit('error', err);
    }
};

Inkscape.prototype.cleanUp = function () {
    if (this.readStream) {
        this.readStream.destroy();
        this.readStream = null;
    }
    if (this.writeStream) {
        this.writeStream.destroy();
        this.writeStream = null;
    }
    if (this.inkscapeProcess) {
        this.inkscapeProcess.kill();
        this.inkscapeProcess = null;
    }
    async.each(this.filesToCleanUp, fs.unlink, function () {});
};

Inkscape.prototype.destroy = function () {
    this.cleanUp();
    this.hasEnded = true;
};

Inkscape.prototype.write = function (chunk) {
    if (this.hasEnded) {
        return;
    }
    if (!this.writeStream) {
        this.filesToCleanUp.push(this.inkscapeInputFilePath);
        this.writeStream = fs.createWriteStream(this.inkscapeInputFilePath);
        this.writeStream.on('error', function (err) {
            this.cleanUp();
            this._error(err);
        }.bind(this));
    }

    this.writeStream.write(chunk);
};

Inkscape.prototype.end = function (chunk) {
    if (this.hasEnded) {
        return;
    }
    if (chunk) {
        this.write(chunk);
    }
    this.writeStream.end();
    this.writable = false;
    this.writeStream.once('close', function () {
        if (this.hasEnded) {
            return;
        }
        this.commandLine = 'inkscape' +  (this.inkscapeArgs ? ' ' + this.inkscapeArgs.join(' ') : ''); // For debugging
        this.inkscapeProcess = childProcess.spawn('inkscape', this.inkscapeArgs);
        var stdoutChunks = [];
        var stderrChunks = [];

        this.inkscapeProcess.stdout.on('data', function (chunk) {
            stdoutChunks.push(chunk);
        });

        this.inkscapeProcess.stderr.on('data', function (chunk) {
            stderrChunks.push(chunk);
        });

        function getStdoutAndStderrAsText() {
            return 'STDOUT: ' + Buffer.concat(stdoutChunks).toString('ascii') + '\nSTDERR: ' + Buffer.concat(stderrChunks).toString('ascii');
        }

        this.inkscapeProcess.once('error', this._error.bind(this));

        this.inkscapeProcess.once('exit', function (exitCode) {
            this.inkscapeProcess = null;
            if (this.hasEnded) {
                return;
            }
            if (exitCode > 0) {
                return this._error(new Error(this.commandLine + ' exited with a non-zero exit code: ' + exitCode + '\n' + getStdoutAndStderrAsText()));
            }
            fs.stat(this.inkscapeOutputFilePath, function (err, stats) {
                if (err) {
                    this.filesToCleanUp.splice(this.filesToCleanUp.indexOf(this.inkscapeOutputFilePath), 1);
                    return this._error(new Error('inkscape ' + this.inkscapeArgs.join(' ') + ' did not write an output file.\n' + getStdoutAndStderrAsText()));
                }
                this.readStream = fs.createReadStream(this.inkscapeOutputFilePath);
                if (this.isPaused) {
                    this.readStream.pause();
                }
                this.readStream.on('data', function (chunk) {
                    this.emit('data', chunk);
                }.bind(this));
                this.readStream.on('end', function () {
                    this.cleanUp();
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
