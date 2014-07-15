/**
 DAEnetIPn node.js support.

 Version:	"0.3"
 Author:	"Theo Gough"
 License:	"GPL v2"
 
 Summary: 
 Provides SNMP access control for the DAEnetIP1/2/3.

 Limitations: 
 DAEnetIP2 via SNMP only (no 1/3).
 Only manages P5 (get/set global or pin state, no adc read)

 */

//export this module
module.exports = DAEnetIP;

//dependencies
var EventEmitter = require( "events" ).EventEmitter;
var snmp = require('net-snmp');

//node.js Module: DAEnetIP
function DAEnetIP( 
	version,		// DAEnet version <2>
	host, 			// ip address of DAEnetIP
	alias, 			// description of the DAEnetIP instance 
	community)		// snmp v1 r/w community string
{

  //OID root for DAEnetIP2 (from MIB)
  var MIB_ROOT = "1.3.6.1.4.1.19865";
  var P3 = "1";		// P3 not supported
  var P5 = "2";		// P5 for 8x relay control
  var P6 = "3";		// P6 not supported
  var AI = "?";		// Analog DIO pins unsupported

  // Public function: checkVersion
  // checks the DAENet version support (only supports v2)
  this.checkVersion = function(v) {
    console.assert(v == '2', 'unsupported version: ' + v);
    return v;
  }

  //properties: configuration with safe defaults
  this.version		= this.checkVersion(version);
  this.alias		= alias		|| 'DAEnetIP' + this.version;
  this.host		= host		|| 'localhost';
  this.community	= community	|| 'public';

  //properties: dynamic
  this.status = {
	P3:'unknown',
	P5:'unknown',
	P6:'unknown',
	AI:'unknown'
    };
  this.status.state = 0x00;

  //this hook
  var instance = this;


  // Public function: toString()
  this.toString = function() {
    return "DAEnetIP" + this.version + "@" + this.host + "(" + this.alias +") = " + this.status.P5; 
  };
  // Public function: toJSON()
  this.toJSON = function() {
    return "{ 'DAEnetIP': {\n" 
	+ "\t'version'\t: '"	+ this.version + "'\n"
	+ "\t'host'\t\t: '"	+ this.host + "'\n"
	+ "\t'alias'\t\t: '"	+ this.alias + "'\n"
	+ "\t'status'\t: ["	+ this.status.P5 + "]\n"
	+ "\t}\n}"; 
  };

  //--------------
  //snmp functions:
  //--------------
  //  getP5State	tested
  //  setP5State	untested
  //  setP5PinVal	tested
  //---------------------------------------------------------------------------
  this.snmpAgent = snmp.createSession (this.host, this.community);

  // get P5 = snmpget -v1 -c private 192.168.1.201 1.3.6.1.4.1.19865.1.2.2.33.0
  this.getP5State = function (callback) {
    console.log("[getP5State]");
    var varbinds = [MIB_ROOT + ".1.2." + P5 + ".33.0"];		// P5 full state value

    instance.snmpAgent.get (varbinds, function (error, varbinds) {
      if (error) {
        console.error (error);
      } else {
            if (snmp.isVarbindError (varbinds[0])) {
                console.error (snmp.varbindError (varbinds[0]));
		instance.emit('error', error);
            } else {
	    	instance.status.P5 = __dioToArray(varbinds[0].value);
		console.log("[getP5State]" + instance.toString());
		instance.emit('getP5State', instance.status.P5);
	    }
      }
      if (callback) {
        callback(error, instance.status.P5);
      }
    });
  };
  // Set P5 = snmpset -v1 -c private 192.168.1.201 1.3.6.1.4.1.19865.1.2.2.33.0 i <hexval>
  this.setP5State = function (p5_state, callback) {
    console.log("[setP5State]("+p5_state+")");

    var varbinds = [{
	oid:	[MIB_ROOT + ".1.2." + P5 + ".33.0"],		// P5 full state value
	type:	snmp.ObjectType.Integer,			// i32
	value:	parseInt(p5_state)				// p5 full value (hexified)
    }];

    instance.snmpAgent.set (varbinds, function (error, varbinds) {
      if (error) {
        console.error (error);
      } else {
            if (snmp.isVarbindError (varbinds[0])) {
                console.error (snmp.varbindError (varbinds[0]));
            } else {
	    	instance.status.P5 = __dioToArray(varbinds[0].value);
		console.log("[setP5State]" + instance.toString());
		instance.emit('setP5State', instance.status.P5);
	    }
      }
      if (callback) {
        callback(error, instance.status.P5);
      }
    });
  };

  // Set P5 PinVal = snmpset -v1 -c private 192.168.1.201 1.3.6.1.4.1.19865.1.2.2.<1...8>.0 i <0|1>
  this.setP5PinVal = function (pin, val, callback) {
    console.log("[setP5PinVal]("+pin+","+val+")");

    var varbinds = [{
	oid:	MIB_ROOT + ".1.2." + P5 + "." + pin + ".0",	// P5 pin 1..8 OID
	type:	snmp.ObjectType.Integer,			// i
	value:	parseInt(val)					// pin value 0|1
    }];

    instance.snmpAgent.set (varbinds, function (error, varbinds) {
      if (error) {
        console.error (error);
      } else {
            if (snmp.isVarbindError (varbinds[0])) {
                console.error (snmp.varbindError (varbinds[0]));
            } else {
	    	instance.status.P5[pin-1] = varbinds[0].value;
		console.log("[setP5PinVal]" + instance.toString());
		instance.emit('setP5PinVal', {'pin':pin,'val':varbinds[0].value});
	    }
      }
      if (callback) {
        callback(error, instance.status.P5);
      }
    });
  };

  // Public function aliases
  this.getState = this.getP5State;
  this.setState = this.setP5State;
  this.setRelayState = this.setP5PinVal;

  //function toggleRelay();
  this.toggleRelay = function (relay, callback) {
    console.log("[toggleRelay](" + relay + ")");

    // get the relay pin value, then flip it
    instance.getP5State(function(error, st) {
	if (error) {
	  console.log(error);
	} else {
	  var newState = (1 - st[parseInt(relay)-1]);
	  instance.setRelayState(relay, newState, callback);
	}
    });
  };

  //internal function to construct an array representation of the relay states
  function __dioToArray(val) {
    return JSON.parse("["+
	(val>>0)%2 + "," + 
	(val>>1)%2 + "," +
	(val>>2)%2 + "," +
	(val>>3)%2 + "," +
	(val>>4)%2 + "," +
	(val>>5)%2 + "," +
	(val>>6)%2 + "," +
	(val>>7)%2 + "]" );
  }

  //static initialisation
  instance.getState();
}

  //extends: EventEmitter
  DAEnetIP.prototype = new EventEmitter();
