const expect = require('unexpected')
  .clone()
  .use(require('unexpected-stream'))
  .use(require('unexpected-sinon'));
const sinon = require('sinon');
const Inkscape = require('../lib/Inkscape');
const pathModule = require('path');
const fs = require('fs');

describe('Inkscape', () => {
  it('should detect the output format as png if -e or --export-png is specified', () => {
    expect(new Inkscape(['-e']).outputFormat, 'to equal', 'png');
    expect(new Inkscape(['--export-png']).outputFormat, 'to equal', 'png');
  });

  it('should detect the output format as pdf if -A or --export-pdf is specified', () => {
    expect(new Inkscape(['-A']).outputFormat, 'to equal', 'pdf');
    expect(new Inkscape(['--export-pdf']).outputFormat, 'to equal', 'pdf');
  });

  it('should detect the output format as eps if -E or --export-eps is specified', () => {
    expect(new Inkscape(['-E']).outputFormat, 'to equal', 'eps');
    expect(new Inkscape(['--export-eps']).outputFormat, 'to equal', 'eps');
  });

  it('should detect the output format as ps if -P or --export-ps is specified', () => {
    expect(new Inkscape(['-P']).outputFormat, 'to equal', 'ps');
    expect(new Inkscape(['--export-ps']).outputFormat, 'to equal', 'ps');
  });

  it('should detect the output format as svg if -l or --export-plain-svg is specified', () => {
    expect(new Inkscape(['-l']).outputFormat, 'to equal', 'svg');
    expect(
      new Inkscape(['--export-plain-svg']).outputFormat,
      'to equal',
      'svg'
    );
  });

  it('the --export-plain-svg=<outputFileName> argument should be injected correctly when -l is specified', () => {
    expect(
      new Inkscape(['-l']).inkscapeArgs.some(inkscapeArg =>
        /^--export-plain-svg=.*\.svg$/.test(inkscapeArg)
      ),
      'to be truthy'
    );
  });

  it('should produce a PNG when run without arguments', () => {
    const inkscape = new Inkscape();

    expect(inkscape.outputFormat, 'to equal', 'png');
    return expect(
      fs
        .createReadStream(pathModule.resolve(__dirname, 'test.svg'))
        .pipe(inkscape),
      'to yield output satisfying when decoded as',
      'binary',
      'to match',
      /^\x89PNG/
    );
  });

  it('should not emit data events while paused', () => {
    const inkscape = new Inkscape();

    function fail() {
      throw new Error('Inkscape emitted data while it was paused!');
    }
    inkscape.pause();
    inkscape.on('data', fail).on('error', () => {});

    expect(inkscape.outputFormat, 'to equal', 'png');
    fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(
      inkscape
    );

    return expect.promise(run => {
      setTimeout(
        run(() => {
          inkscape.removeListener('data', fail);

          inkscape.resume();
          return expect(inkscape, 'to yield output satisfying', {
            length: expect.it('to be greater than', 0)
          });
        }),
        1000
      );
    });
  });

  it('should emit an error if an invalid image is processed', done => {
    const inkscape = new Inkscape();

    inkscape
      .on('error', () => {
        done();
      })
      .on('data', chunk => {
        done(new Error('Inkscape emitted data when an error was expected'));
      })
      .on('end', chunk => {
        done(new Error('Inkscape emitted end when an error was expected'));
      });

    inkscape.end(Buffer.from('qwvopeqwovkqvwiejvq', 'utf-8'));
  });

  it('should emit a single error if an invalid command line is specified', done => {
    const inkscape = new Inkscape(['-vqve']);

    let seenError = false;

    inkscape
      .on('error', () => {
        expect(
          inkscape.commandLine,
          'to match',
          /inkscape --without-gui -vqve -e=.*?\.png .*?\.svg$/
        );
        if (seenError) {
          done(new Error('More than one error event was emitted'));
        } else {
          seenError = true;
          setTimeout(done, 100);
        }
      })
      .on('data', chunk => {
        done(new Error('inkscape emitted data when an error was expected'));
      })
      .on('end', chunk => {
        done(new Error('inkscape emitted end when an error was expected'));
      });

    inkscape.end(Buffer.from('qwvopeqwovkqvwiejvq', 'utf-8'));
  });

  describe('#destroy', () => {
    describe('when called before the fs.WriteStream is created', () => {
      it('should not create the fs.WriteStream or launch the inkscape process', () => {
        const inkscape = new Inkscape();
        fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(
          inkscape
        );
        inkscape.destroy();
        return expect.promise(run => {
          setTimeout(
            run(() => {
              expect(inkscape, 'to satisfy', {
                writeStream: expect.it('to be falsy'),
                inkscapeProcess: expect.it('to be falsy')
              });
            }),
            10
          );
        });
      });
    });

    describe('when called while the fs.WriteStream is active', () => {
      it('should abort the fs.WriteStream and remove the temporary file', () => {
        const inkscape = new Inkscape();
        fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(
          inkscape
        );

        return expect.promise(run => {
          setTimeout(
            run(function waitForWriteStream() {
              const writeStream = inkscape.writeStream;
              if (inkscape.writeStream) {
                inkscape.destroy();
                expect(inkscape.writeStream, 'to be falsy');
                sinon.spy(writeStream, 'end');
                sinon.spy(writeStream, 'write');
                setTimeout(
                  run(() => {
                    expect(
                      [writeStream.end, writeStream.write],
                      'to have calls satisfying',
                      []
                    );
                  }),
                  10
                );
              } else {
                setTimeout(run(waitForWriteStream), 0);
              }
            }),
            0
          );
        });
      });
    });

    describe('when called while the inkscape process is running', () => {
      it('should kill the inkscape process and remove the temporary file', () => {
        const inkscape = new Inkscape();
        fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(
          inkscape
        );

        sinon.spy(fs, 'unlink');
        return expect
          .promise(run => {
            setTimeout(
              run(function waitForInkscapeProcess() {
                const inkscapeProcess = inkscape.inkscapeProcess;
                if (inkscape.inkscapeProcess) {
                  sinon.spy(inkscapeProcess, 'kill');
                  expect(inkscape.filesToCleanUp, 'to satisfy', [
                    expect.it('to be a string'),
                    expect.it('to be a string')
                  ]);
                  const filesToCleanUp = [].concat(inkscape.filesToCleanUp);
                  inkscape.destroy();
                  expect(
                    [inkscapeProcess.kill, fs.unlink],
                    'to have calls satisfying',
                    () => {
                      inkscapeProcess.kill();
                      fs.unlink(
                        filesToCleanUp[0],
                        expect.it('to be a function')
                      );
                      fs.unlink(
                        filesToCleanUp[1],
                        expect.it('to be a function')
                      );
                    }
                  );
                  expect(inkscape.inkscapeProcess, 'to be falsy');
                } else {
                  setTimeout(run(waitForInkscapeProcess), 0);
                }
              }),
              0
            );
          })
          .finally(() => {
            fs.unlink.restore();
          });
      });
    });

    describe('when called while streaming from the temporary output file', () => {
      it('should kill the inkscape process and remove the temporary output file', () => {
        const inkscape = new Inkscape();
        fs.createReadStream(pathModule.resolve(__dirname, 'test.svg')).pipe(
          inkscape
        );
        inkscape.pause();
        sinon.spy(fs, 'unlink');
        return expect
          .promise(run => {
            setTimeout(
              run(function waitForReadStream() {
                const readStream = inkscape.readStream;
                if (readStream) {
                  sinon.spy(readStream, 'destroy');
                  expect(inkscape.inkscapeProcess, 'to be falsy');
                  expect(inkscape.filesToCleanUp, 'to satisfy', [
                    expect.it('to be a string'),
                    expect.it('to be a string')
                  ]);
                  const filesToCleanUp = [].concat(inkscape.filesToCleanUp);
                  inkscape.destroy();
                  expect(
                    [fs.unlink, readStream.destroy],
                    'to have calls satisfying',
                    () => {
                      readStream.destroy();
                      fs.unlink(
                        filesToCleanUp[0],
                        expect.it('to be a function')
                      );
                      fs.unlink(
                        filesToCleanUp[1],
                        expect.it('to be a function')
                      );
                    }
                  );
                } else {
                  setTimeout(run(waitForReadStream), 0);
                }
              }),
              0
            );
          })
          .finally(() => {
            fs.unlink.restore();
          });
      });
    });
  });

  // Doesn't seem to work on Travis, probably due to no X being installed
  if (!process.env.CI) {
    describe('when utilizing verbs', () => {
      it('should operate in GUI mode', () => {
        const inkscape = new Inkscape([
          '--verb=EditDeselect',
          '--select=layer9',
          '--verb=SelectionUnion',
          '--verb=EditDelete',
          '--verb=FileSave',
          '--verb=FileClose',
          '--verb=FileQuit'
        ]);
        expect(inkscape.commandLine, 'not to contain', '--without-gui');
      });

      it('should treat the input file as the output file (assuming --verb=FileSave)', () => {
        const inkscape = new Inkscape([
          '--verb=EditDeselect',
          '--select=layer9',
          '--verb=SelectionUnion',
          '--verb=EditDelete',
          '--verb=FileSave',
          '--verb=FileClose',
          '--verb=FileQuit'
        ]);

        return expect(
          fs
            .createReadStream(pathModule.resolve(__dirname, 'test.svg'))
            .pipe(inkscape),
          'to yield output satisfying when decoded as',
          'utf-8',
          'to satisfy',
          expect
            .it('to begin with', '<?xml')
            .and('to contain', '<svg')
            .and('not to contain', 'layer9')
        );
      });
    });
  }
});
