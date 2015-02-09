/*
 *  NACHA File Library
 *
 *  The MIT License (MIT)
 *  Copyright (c) 2015
 *  Knox Payments, Inc. (https://knoxpayments.com)
 *  Peter Hanneman (peter.a.hanneman@gmail.com)
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in all
 *  copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *  SOFTWARE.
 */


// All variable names correspond with the 2014 NACHA specification language
var addendaSequenceNumber = 1,
    batchId = 0,
    batchFooter,
    batchHeader,
    batchLines,
    batchNumber,
    batchCount = 0,
    blockingFactor = '10',
    companyDescriptiveDate,
    companyDiscretionaryData = '',
    companyEntryDescription = '',
    companyId,
    companyName,
    creditTotal = 0,
    debitTotal = 0,
    detailRecordCount = 0,
    effectiveEntryDate,
    errorRecords = [],
    fileDetailRecordCount = 0,
    fileContents = '',
    fileCreditTotal = 0,
    fileDebitTotal = 0,
    fileFooter = '',
    fileHeader = '',
    fileModifer = 'A',
    fileRoutingHash = 0,
    formatcode = '1',
    immediateDestination,
    immediateDestinationName,
    immediateOrigin,
    immediateOrigin,
    immediateOriginName,
    recordsize = '094',
    routingHash = 0,
    traceNumber = 0;


String.prototype.padLeft = function(pad, length) {
    return String(Array(1 + length).join(pad) + this).slice(-length);
};


String.prototype.padRight = function(pad, length) {
    return this + Array(1 + length - this.length).join(pad || ' ');
};


function formatText(text, spaces) {
    return text.toUpperCase().padRight(' ', spaces).substr(0, spaces);
}


function formatNumeric(number, spaces) {
    return String(number).replace('.', '').replace(',', '').padLeft(0, spaces);
}


// ABA routing number checksum algorithm (pass as String)
function isValidRoutingNumber(routingNumber) {
    if (routingNumber.length !== 9 || !/\d{9}/.test(routingNumber)) {
        return false;
    }

    var d = routingNumber.split('').map(Number),
            sum = 3 * (d[0] + d[3] + d[6]) +
                  7 * (d[1] + d[4] + d[7]) +
                  1 * (d[2] + d[5] + d[8]);

    return sum % 10 === 0;
}


// Adds a debit to the active company batch, defaults to an account type of "CHECKING"
function addDebit(payment) {
    if (!payment.transactionCode) {
        if (payment.accountType) {
            if (payment.accountType === 'CHECKING') {
                payment.transactionCode = '27';
            } else if (payment.accountType === 'SAVINGS') {
                payment.transactionCode = '37';
            } else {
                return false;
            }
        } else {
            payment.transactionCode = '27';
        }
    }
    addDetailLine(payment);
    return true;
}


// Adds a credit to current company batch, defaults to an account type of "CHECKING"
// (Some RDFIs will auto correct this for you, others will hit you with a fee)
function addCredit(payment) {
    if (!payment.transactionCode) {
        if (payment.accountType) {
            if (payment.accountType === 'CHECKING') {
                payment.transactionCode = '22';
            } else if (payment.accountType === 'SAVINGS') {
                payment.transactionCode = '32';
            } else {
                return false;
            }
        } else {
            payment.transactionCode = '22';
        }
    }
    addDetailLine(payment);
    return true;
}


// Adds a payment (credit or debit) to the batch entry and increments the trace #
function addDetailLine(payment) {
    payment.traceNumber = 1 + traceNumber;
    if (createDetailRecord(payment)) {
        traceNumber++;
        return true;
    } else {
        payment.traceNumber = false;
        errorRecords.push(payment);
        return false;
    }
    return true;
}


// Constructs the file header control record
// "Increment" the file modifier if you're sending more than one file a day to your ODFI with the same effective date
function createFileHeader(fileModifierArg) {
    var now = new Date().toISOString().replace(/T/, '').replace(/\..+/, '').replace(/-/, '').replace(/:/, '').replace(/-/, '').slice(2, -3);

    if (fileModifierArg) {
        fileModifier = fileModifierArg;
    }

    fileHeader = '101 ' + immediateDestination + immediateOrigin + now + fileModifer + recordsize +
                 blockingFactor + formatcode + formatText(immediateDestinationName, 23) +
                 formatText(immediateOriginName, 23) + formatNumeric(batchId, 8);

    return fileHeader.length === 94;
}


// Constructs a new company batch header record
function createBatchHeader(scc, sec) {
    batchCount++;

    batchHeader = '5' + scc + formatText(companyName, 16) + formatText(companyDiscretionaryData, 20) +
                  companyId + sec + formatText(companyEntryDescription, 10) + formatText(companyDescriptiveDate, 6) +
                  effectiveEntryDate + '   1' + immediateDestination.substr(0, 8) + formatNumeric(batchNumber, 7);

    return batchHeader.length === 94;
}


// Adds either a credit or debit transaction to the open company batch
function createDetailRecord(payment) {
    var addendaRecordIndicator = payment.addendum.length > 0 ? '1' : '0';

    var line = '6' + payment.transactionCode + formatNumeric(payment.rdfiIdentificationNumber, 9) +
               formatText(payment.dfiAccount, 17) + formatNumeric(payment.amount.toFixed(2), 10) +
               formatText(payment.individualIdNumber, 15) + formatText(payment.individualName, 22) +
               formatText(payment.discretionaryData, 2) + addendaRecordIndicator +
               immediateDestination.substr(0, 8) + formatNumeric(payment.traceNumber, 7);

    if (line.length === 94) {
        batchLines = line + '\r\n';
        detailRecordCount++;
        routingHash += +payment.rdfiIdentificationNumber.substr(0, 8);

        if (payment.transactionCode == 27 || payment.transactionCode == 37) {
            debitTotal += payment.amount;
        } else {
            creditTotal += payment.amount;
        }

        if (addendaRecordIndicator) {
            createAddendumRecord(payment.addendum, payment.traceNumber);
        }

        return true;
    }
    return false;
}


// Creates a (usually) optional addenda record with additional details for the bank statements
function createAddendumRecord(addendum, traceNumber) {
    var line = '705' + formatText(addendum, 80) + formatNumeric(addendaSequenceNumber, 4) + formatNumeric(traceNumber, 7);

    if (line.length === 94) {
        detailRecordCount++;
        batchLines += line + '\r\n';
    }
}


// Constructs a company batch control record based on the payments added to the company record
function createBatchFooter(scc) {
    batchFooter = '8' + scc + formatNumeric(detailRecordCount, 6) + formatNumeric(routingHash, 10) +
                  formatNumeric(debitTotal.toFixed(2), 12) + formatNumeric(creditTotal.toFixed(2), 12) +
                  formatText(companyId, 10) + formatText('', 25) + immediateDestination.substr(0, 8) +
                  formatNumeric(batchNumber, 7);

    batchNumber++;
    fileCreditTotal += creditTotal;
    fileDebitTotal += debitTotal;

    fileDetailRecordCount += detailRecordCount;
    detailRecordCount = 0;
    traceNumber = 0;
    fileRoutingHash += routingHash;
    routingHash = 0;

    creditTotal = 0;
    debitTotal = 0;

    return batchFooter.length === 94;
}


// Terminates the batch file with proper hash calculations and blocking factor
function createFileFooter() {
    var linecount = fileDetailRecordCount + (batchCount * 2) + 2,
        blocks = Math.ceil(linecount / 10),
        fillersToAdd = 10 * blocks - linecount;

    fileFooter = '9' + formatNumeric(batchCount, 6) + formatNumeric(blocks, 6) + formatNumeric(fileDetailRecordCount, 8) +
                 formatNumeric(fileRoutingHash, 10) + formatNumeric(fileDebitTotal.toFixed(2), 12) +
                 formatNumeric(fileCreditTotal.toFixed(2), 12) + formatText('', 39);

    var validFileFooter = fileFooter.length === 94;

    for (var i = 0; i < fillersToAdd; i++) {
        fileFooter += '\r\n' + String().padLeft(9, 94);
    }

    return validFileFooter;
}


// Used to setup the library before first use
function applyFileHeaderSettings(fileHeaderFields) {
    batchId = fileHeaderFields.batchId;
    immediateDestination = fileHeaderFields.immediateDestination;
    immediateOrigin = fileHeaderFields.immediateOrigin;
    immediateDestinationName = fileHeaderFields.immediateDestinationName;
    immediateOriginName = fileHeaderFields.immediateOriginName;
    fileModifier = (fileHeaderFields.fileModifier ? fileHeaderFields.fileModifer : fileModifer);
}


// Used to change the details of the individual company records within a single file
function applyCompanyHeaderSettings(companyHeaderFields) {
    batchNumber = companyHeaderFields.nextBatchNumber;
    companyName = companyHeaderFields.companyName;
    companyDiscretionaryData = companyHeaderFields.companyDiscretionaryData;
    companyId = companyHeaderFields.companyId;
    companyEntryDescription = companyHeaderFields.companyEntryDescription;
    companyDescriptiveDate = companyHeaderFields.companyDescriptiveDate;
    effectiveEntryDate = companyHeaderFields.effectiveEntryDate;
}


module.exports = {
    applyFileHeaderSettings:
        function(fileHeaderFields) {
            return applyFileHeaderSettings(fileHeaderFields);
        },
    applyCompanyHeaderSettings:
        function(companyHeaderFields) {
            return applyCompanyHeaderSettings(companyHeaderFields);
        },
    createFileHeader:
        function(fileModifier) {
            if (createFileHeader(fileModifer ? fileModifer : false)) {
                fileContents = fileHeader + '\r\n';
                return true;
            }
            return false;
        },
    createBatchHeader:
        function(scc, sec) {
            if (createBatchHeader(scc, sec)) {
                fileContents += batchHeader + '\r\n';
                return true;
            }
            return false;
        },
    addDebit:
        function(payment) {
            if (addDebit(payment)) {
                fileContents += batchLines;
                return true;
            }
            return false;
        },
    addCredit:
        function(payment) {
            if (addCredit(payment)) {
                fileContents += batchLines;
                return true;
            }
            return false;
        },
    createBatchFooter:
        function(scc) {
            if (createBatchFooter(scc)) {
                fileContents += batchFooter + '\r\n';
                return true;
            }
            return false;
        },
    createFileFooter:
        function() {
            if (createFileFooter()) {
                fileContents += fileFooter;
                return true;
            }
            return false;
        },
    fetchFile:
        function() {
            return fileContents;
        },
    fetchNextBatchNumber:
        function() {
            return batchNumber;
        },
    isValidRoutingNumber:
        function(routingNumber) {
            return isValidRoutingNumber(routingNumber);
        },
    reset:
        function() {
            addendaSequenceNumber = 1;
            batchId = 0;
            batchFooter = null;
            batchHeader = null;
            batchLines = null;
            batchNumber = null;
            batchCount = 0;
            blockingFactor = '10';
            companyDescriptiveDate = null;
            companyDiscretionaryData = '';
            companyEntryDescription = '';
            companyId = null;
            companyName = null;
            creditTotal = 0;
            debitTotal = 0;
            detailRecordCount = 0;
            effectiveEntryDate = null;
            errorRecords = [];
            fileDetailRecordCount = 0;
            fileContents = '';
            fileCreditTotal = 0;
            fileDebitTotal = 0;
            fileFooter = '';
            fileHeader = '';
            fileModifer = 'A';
            fileRoutingHash = 0;
            formatcode = '1';
            immediateDestination = null;
            immediateDestinationName = null;
            immediateOrigin = null;
            immediateOrigin = null;
            immediateOriginName = null;
            recordsize = '094';
            routingHash = 0;
            traceNumber = 0;
        }
};
