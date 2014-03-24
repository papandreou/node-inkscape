var expect = require('unexpected'),
    Inkscape = require('../lib/Inkscape'),
    Path = require('path'),
    fs = require('fs');

describe('Inkscape', function () {
    it('should detect the output format as png if -e or --export-png is specified', function () {
        expect(new Inkscape(['-e']).outputFormat, 'to equal', 'png');
        expect(new Inkscape(['--export-png']).outputFormat, 'to equal', 'png');
    });

    it('should detect the output format as pdf if -A or --export-pdf is specified', function () {
        expect(new Inkscape(['-A']).outputFormat, 'to equal', 'pdf');
        expect(new Inkscape(['--export-pdf']).outputFormat, 'to equal', 'pdf');
    });

    it('should detect the output format as eps if -E or --export-eps is specified', function () {
        expect(new Inkscape(['-E']).outputFormat, 'to equal', 'eps');
        expect(new Inkscape(['--export-eps']).outputFormat, 'to equal', 'eps');
    });

    it('should detect the output format as ps if -P or --export-ps is specified', function () {
        expect(new Inkscape(['-P']).outputFormat, 'to equal', 'ps');
        expect(new Inkscape(['--export-ps']).outputFormat, 'to equal', 'ps');
    });

    it('should detect the output format as svg if -l or --export-plain-svg is specified', function () {
        expect(new Inkscape(['-l']).outputFormat, 'to equal', 'svg');
        expect(new Inkscape(['--export-plain-svg']).outputFormat, 'to equal', 'svg');
    });

    it('the --export-plain-svg=<outputFileName> argument should be injected correctly when -l is specified', function () {
        expect(new Inkscape(['-l']).inkscapeArgs.some(function (inkscapeArg) {return /^--export-plain-svg=.*\.svg$/.test(inkscapeArg);}), 'to be truthy');
    });

    it('should produce a PNG when run without arguments', function (done) {
        var inkscape = new Inkscape(),
            chunks = [];

        expect(inkscape.outputFormat, 'to equal', 'png');
        fs.createReadStream(Path.resolve(__dirname, 'test.svg'))
            .pipe(inkscape)
            .on('data', function (chunk) {
                chunks.push(chunk);
            })
            .on('end', function () {
                var resultPngBuffer = Buffer.concat(chunks);
                expect(resultPngBuffer.length, 'to be greater than', 4);
                expect(resultPngBuffer[0], 'to equal', 0x89);
                expect(resultPngBuffer[1], 'to equal', 0x50); // P
                expect(resultPngBuffer[2], 'to equal', 0x4e); // N
                expect(resultPngBuffer[3], 'to equal', 0x47); // G
                done();
            })
            .on('error', done);
    });

    it('should not emit data events while paused', function (done) {
        var inkscape = new Inkscape();

        function fail() {
            done(new Error('Inkscape emitted data while it was paused!'));
        }
        inkscape.pause();
        inkscape.on('data', fail).on('error', done);

        fs.createReadStream(Path.resolve(__dirname, 'test.svg')).pipe(inkscape);

        setTimeout(function () {
            inkscape.removeListener('data', fail);
            var chunks = [];

            inkscape
                .on('data', function (chunk) {
                    chunks.push(chunk);
                })
                .on('end', function () {
                    var resultPngBuffer = Buffer.concat(chunks);
                    expect(resultPngBuffer.length, 'to be greater than', 0);
                    done();
                });

            inkscape.resume();
        }, 1000);
    });

    it('should emit an error if an invalid image is processed', function (done) {
        var inkscape = new Inkscape();

        inkscape.on('error', function (err) {
            done();
        }).on('data', function (chunk) {
            done(new Error('Inkscape emitted data when an error was expected'));
        }).on('end', function (chunk) {
            done(new Error('Inkscape emitted end when an error was expected'));
        });

        inkscape.end(new Buffer('qwvopeqwovkqvwiejvq', 'utf-8'));
    });
});
