const childProcess = require('child_process');
const Stream = require('stream').Stream;
const util = require('util');
const fs = require('fs');
const getTemporaryFilePath = require('gettemporaryfilepath');
const async = require('async');

class Inkscape extends Stream {
  constructor(inkscapeArgs) {
    super();

    this.writable = true;
    this.readable = true;

    this.hasEnded = false;

    let setOutputFormat = false;
    let setInputFormat = false;

    this.inkscapeArgs = [];

    this.guiMode = false;

    if (
      inkscapeArgs &&
      inkscapeArgs.some(inkscapeArg => /^--verb/.test(inkscapeArg))
    ) {
      this.guiMode = true;
    } else {
      this.inkscapeArgs.push('--without-gui');
    }

    (inkscapeArgs || []).forEach(inkscapeArg => {
      const matchInkscapeArg = inkscapeArg.match(
        /^(-e|-P|-E|-A|-l|--export-(?:plain-svg|png|ps|eps|pdf)|--import-(?:plain-svg|png|ps|eps|pdf))(?:=|$)$/
      );
      if (matchInkscapeArg) {
        if (inkscapeArg === '-e' || inkscapeArg === '--export-png') {
          this.outputFormat = 'png';
          setOutputFormat = inkscapeArg;
        } else if (inkscapeArg === '-A' || inkscapeArg === '--export-pdf') {
          this.outputFormat = 'pdf';
          setOutputFormat = inkscapeArg;
        } else if (inkscapeArg === '-E' || inkscapeArg === '--export-eps') {
          this.outputFormat = 'eps';
          setOutputFormat = inkscapeArg;
        } else if (inkscapeArg === '-P' || inkscapeArg === '--export-ps') {
          this.outputFormat = 'ps';
          setOutputFormat = inkscapeArg;
        } else if (
          inkscapeArg === '-l' ||
          inkscapeArg === '--export-plain-svg'
        ) {
          this.outputFormat = 'svg';
          setOutputFormat = inkscapeArg;
        } else if (inkscapeArg === '--import-pdf') {
          this.inputFormat = 'pdf';
          setInputFormat = inkscapeArg;
        } else if (inkscapeArg === '--import-eps') {
          this.inputFormat = 'eps';
          setInputFormat = inkscapeArg;
        } else if (inkscapeArg === '--import-ps') {
          this.inputFormat = 'ps';
          setInputFormat = inkscapeArg;
        } else if (inkscapeArg === '--import-plain-svg') {
          this.inputFormat = 'svg';
          setInputFormat = inkscapeArg;
        } else {
          throw new Error(
            'Internal error: Unable to parse switch: ' + matchInkscapeArg[1]
          );
        }
      } else {
        this.inkscapeArgs.push(inkscapeArg);
      }

      if (setOutputFormat) {
        if (this.guiMode) {
          throw new Error(
            'Cannot use ' +
              setOutputFormat +
              ' when --verb=... is in use. Please use --FileSave instead'
          );
        }
        this.inkscapeOutputFilePath = getTemporaryFilePath({
          suffix: '.' + this.outputFormat
        });
        this.inkscapeArgs.push(
          '--export-' +
            (this.outputFormat === 'svg' ? 'plain-' : '') +
            this.outputFormat +
            '=' +
            this.inkscapeOutputFilePath
        );
        setOutputFormat = false;
      } else if (setInputFormat) {
        this.inkscapeInputFilePath = getTemporaryFilePath({
          suffix: '.' + (this.inputFormat || 'svg')
        });
        this.inkscapeArgs.push(this.inkscapeInputFilePath);
        setInputFormat = false;
      }
    });

    if (!this.outputFormat && !this.guiMode) {
      this.outputFormat = 'png';
      this.inkscapeOutputFilePath = getTemporaryFilePath({
        suffix: '.' + this.outputFormat
      });
      this.inkscapeArgs.push('-e=' + this.inkscapeOutputFilePath);
    }

    if (!this.inputFormat) {
      this.inputFormat = 'svg';
      this.inkscapeInputFilePath = getTemporaryFilePath({ suffix: '.svg' });
      this.inkscapeArgs.push(this.inkscapeInputFilePath);
    }

    this.filesToCleanUp = [];

    if (this.guiMode) {
      this.inkscapeOutputFilePath = this.inkscapeInputFilePath;
    } else {
      this.filesToCleanUp.push(this.inkscapeOutputFilePath);
    }
    this.commandLine =
      'inkscape' + (this.inkscapeArgs ? ' ' + this.inkscapeArgs.join(' ') : ''); // For debugging
  }

  _error(err) {
    if (!this.hasEnded) {
      this.hasEnded = true;
      this.cleanUp();
      this.emit('error', err);
    }
  }

  cleanUp() {
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
    async.each(this.filesToCleanUp, fs.unlink, () => {});
  }

  destroy() {
    this.cleanUp();
    this.hasEnded = true;
  }

  write(chunk) {
    if (this.hasEnded) {
      return;
    }
    if (!this.writeStream) {
      this.filesToCleanUp.push(this.inkscapeInputFilePath);
      this.writeStream = fs.createWriteStream(this.inkscapeInputFilePath);
      this.writeStream.on('error', err => {
        this.cleanUp();
        this._error(err);
      });
    }

    this.writeStream.write(chunk);
  }

  end(chunk) {
    if (this.hasEnded) {
      return;
    }
    if (chunk) {
      this.write(chunk);
    }
    this.writeStream.end();
    this.writable = false;
    this.writeStream.once('close', () => {
      if (this.hasEnded) {
        return;
      }
      this.inkscapeProcess = childProcess.spawn('inkscape', this.inkscapeArgs);
      const stdoutChunks = [];
      const stderrChunks = [];

      this.inkscapeProcess.stdout.on('data', chunk => {
        stdoutChunks.push(chunk);
      });

      this.inkscapeProcess.stderr.on('data', chunk => {
        stderrChunks.push(chunk);
      });

      function getStdoutAndStderrAsText() {
        return (
          'STDOUT: ' +
          Buffer.concat(stdoutChunks).toString('ascii') +
          '\nSTDERR: ' +
          Buffer.concat(stderrChunks).toString('ascii')
        );
      }

      this.inkscapeProcess.once('error', this._error.bind(this));

      this.inkscapeProcess.once('exit', exitCode => {
        this.inkscapeProcess = null;
        if (this.hasEnded) {
          return;
        }
        if (exitCode > 0) {
          return this._error(
            new Error(
              this.commandLine +
                ' exited with a non-zero exit code: ' +
                exitCode +
                '\n' +
                getStdoutAndStderrAsText()
            )
          );
        }
        fs.stat(this.inkscapeOutputFilePath, (err, stats) => {
          if (err) {
            this.filesToCleanUp.splice(
              this.filesToCleanUp.indexOf(this.inkscapeOutputFilePath),
              1
            );
            return this._error(
              new Error(
                'inkscape ' +
                  this.inkscapeArgs.join(' ') +
                  ' did not write an output file.\n' +
                  getStdoutAndStderrAsText()
              )
            );
          }
          this.readStream = fs.createReadStream(this.inkscapeOutputFilePath);
          if (this.isPaused) {
            this.readStream.pause();
          }
          this.readStream.on('data', chunk => {
            this.emit('data', chunk);
          });
          this.readStream.on('end', () => {
            this.cleanUp();
            this.emit('end');
          });
        });
      });
    });
  }

  // Proxy pause and resume to the underlying readStream if it has been
  // created, otherwise just keep track of the paused state:
  pause() {
    this.isPaused = true;
    if (this.readStream) {
      this.readStream.pause();
    }
  }

  resume() {
    this.isPaused = false;
    if (this.readStream) {
      this.readStream.resume();
    }
  }
}

module.exports = Inkscape;
