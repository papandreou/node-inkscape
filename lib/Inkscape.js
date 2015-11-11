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

    this.writable = true;
    this.readable = true;

    this.hasEnded = false;

    this.filesToCleanUp = [];
    var setOutputFormat = false;
    var setInputFormat = false;

    var inkscapeArgsTemp = this.inkscapeArgs; // to make sure that the import parameters are not passed later to inkscape
    this.inkscapeArgs = [];

    for (var i = 0 ; i < inkscapeArgsTemp.length ; i += 1) {
        var matchInkscapeArg = inkscapeArgsTemp[i].match(/^(-e|-P|-E|-A|-l|--export-(?:plain-svg|png|ps|eps|pdf)|--import-(?:plain-svg|png|ps|eps|pdf))(?:=|$)$/);
        if (matchInkscapeArg) {
            if (matchInkscapeArg[1] === '-e' || matchInkscapeArg[1] === '--export-png') {
                this.outputFormat = 'png'; setOutputFormat = true; 
            } else if (matchInkscapeArg[1] === '-A' || matchInkscapeArg[1] === '--export-pdf') {
                this.outputFormat = 'pdf'; setOutputFormat = true;
            } else if (matchInkscapeArg[1] === '-E' || matchInkscapeArg[1] === '--export-eps') {
                this.outputFormat = 'eps'; setOutputFormat = true;
            } else if (matchInkscapeArg[1] === '-P' || matchInkscapeArg[1] === '--export-ps') {
                this.outputFormat = 'ps'; setOutputFormat = true;
            } else if (matchInkscapeArg[1] === '-l' || matchInkscapeArg[1] === '--export-plain-svg') {
                this.outputFormat = 'svg'; setOutputFormat = true;
            } else if (matchInkscapeArg[1] === '--import-pdf') {
                this.inputFormat = 'pdf'; setInputFormat = true;
            } else if (matchInkscapeArg[1] === '--import-eps') {
                this.inputFormat = 'eps'; setInputFormat = true;
            } else if (matchInkscapeArg[1] === '--import-ps') {
                this.inputFormat = 'ps'; setInputFormat = true;
            } else if (matchInkscapeArg[1] === '--import-plain-svg') {
                this.inputFormat = 'svg'; setInputFormat = true;
            } else {
                throw new Error('Internal error: Unable to parse switch: ' + matchInkscapeArg[1]);
            }

            if (setOutputFormat) {
                this.inkscapeOutputFilePath = getTemporaryFilePath({suffix: '.' + this.outputFormat});
                this.inkscapeArgs.push('--export-' + (this.outputFormat === 'svg' ? 'plain-' : '') + this.outputFormat + '=' + this.inkscapeOutputFilePath);
                setOutputFormat = false;  
            }
            else if (setInputFormat) {
                this.inkscapeInputFilePath = getTemporaryFilePath({suffix: "."+this.inputFormat});
                this.inkscapeArgs.push(this.inkscapeInputFilePath);
                setInputFormat = false;
            }
        }
        else {
            this.inkscapeArgs.push(inkscapeArgsTemp[i]);
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

    if (!this.inputFormat) {
        this.inputFormat = 'svg';
        this.inkscapeInputFilePath = getTemporaryFilePath({suffix: '.svg'});
    }

    this.filesToCleanUp = [];
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
