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

    var setOutputFormat = false;
    var setInputFormat = false;

    var inkscapeArgsTemp = this.inkscapeArgs; // to make sure that the import parameters are not passed later to inkscape
    this.inkscapeArgs = [];

    for (var i = 0 ; i < inkscapeArgsTemp.length ; i += 1) {
        var matchInkscapeArg = inkscapeArgsTemp[i].match(/^(-e|-P|-E|-A|-l|--export-(?:plain-svg|png|ps|eps|pdf)|--import-(?:plain-svg|png|ps|eps|pdf))(?:=|$)$/);
        if (matchInkscapeArg) {
            var inkscapeArg = matchInkscapeArg[1];
            if (inkscapeArg === '-e' || inkscapeArg === '--export-png') {
                this.outputFormat = 'png'; setOutputFormat = true; 
            } else if (inkscapeArg === '-A' || inkscapeArg === '--export-pdf') {
                this.outputFormat = 'pdf'; setOutputFormat = true;
            } else if (inkscapeArg === '-E' || inkscapeArg === '--export-eps') {
                this.outputFormat = 'eps'; setOutputFormat = true;
            } else if (inkscapeArg === '-P' || inkscapeArg === '--export-ps') {
                this.outputFormat = 'ps'; setOutputFormat = true;
            } else if (inkscapeArg === '-l' || inkscapeArg === '--export-plain-svg') {
                this.outputFormat = 'svg'; setOutputFormat = true;
            } else if (inkscapeArg === '--import-pdf') {
                this.inputFormat = 'pdf'; setInputFormat = true;
            } else if (inkscapeArg === '--import-eps') {
                this.inputFormat = 'eps'; setInputFormat = true;
            } else if (inkscapeArg === '--import-ps') {
                this.inputFormat = 'ps'; setInputFormat = true;
            } else if (inkscapeArg === '--import-plain-svg') {
                this.inputFormat = 'svg'; setInputFormat = true;
            } else {
                throw new Error('Internal error: Unable to parse switch: ' + inkscapeArg);
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

    if (!this.inputFormat) {
        this.inputFormat = 'svg';
        this.inkscapeInputFilePath = getTemporaryFilePath({suffix: '.svg'});
        this.inkscapeArgs.push(this.inkscapeInputFilePath);
    }

    this.filesToCleanUp = [];
}

util.inherits(Inkscape, Stream);

Inkscape.prototype._reportError = function (err) {
    if (!this.hasEnded) {
        this.hasEnded = true;
        this.emit('error', err);
    }
};

Inkscape.prototype.cleanUp = function (cb) {
    var filesToCleanUp = [].concat(this.filesToCleanUp);
    this.filesToCleanUp = [];
    async.each(filesToCleanUp, fs.unlink, cb);
};

Inkscape.prototype.write = function (chunk) {
    if (!this.writeStream) {
        this.filesToCleanUp.push(this.inkscapeInputFilePath);
        this.writeStream = fs.createWriteStream(this.inkscapeInputFilePath);
        this.writeStream.on('error', function (err) {
            this.cleanUp();
            this._reportError(err);
        }.bind(this));
    }

    this.writeStream.write(chunk);
};

Inkscape.prototype.end = function (chunk) {
    if (chunk) {
        this.write(chunk);
    }
    this.writeStream.end();
    this.writable = false;
    this.writeStream.on('close', function () {
        this.filesToCleanUp.push(this.inkscapeOutputFilePath);
        this.commandLine = 'inkscape' +  (this.inkscapeArgs ? ' ' + this.inkscapeArgs.join(' ') : ''); // For debugging
        var inkscapeProcess = childProcess.spawn('inkscape', this.inkscapeArgs),
            stdoutChunks = [],
            stderrChunks = [];

        inkscapeProcess.stdout.on('data', function (chunk) {
            stdoutChunks.push(chunk);
        });

        inkscapeProcess.stderr.on('data', function (chunk) {
            stderrChunks.push(chunk);
        });

        function getStdoutAndStderrAsText() {
            return 'STDOUT: ' + Buffer.concat(stdoutChunks).toString('ascii') + '\nSTDERR: ' + Buffer.concat(stderrChunks).toString('ascii');
        }

        inkscapeProcess.on('error', this._reportError.bind(this));

        inkscapeProcess.on('exit', function (exitCode) {
            if (exitCode > 0) {
                this.cleanUp();
                return this._reportError(new Error(this.commandLine + ' exited with a non-zero exit code: ' + exitCode + '\n' + getStdoutAndStderrAsText()));
            }
            fs.stat(this.inkscapeOutputFilePath, function (err, stats) {
                if (err) {
                    this.filesToCleanUp.splice(this.filesToCleanUp.indexOf(this.inkscapeOutputFilePath), 1);
                    this.cleanUp();
                    return this._reportError(new Error('inkscape ' + this.inkscapeArgs.join(' ') + ' did not write an output file.\n' + getStdoutAndStderrAsText()));
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
