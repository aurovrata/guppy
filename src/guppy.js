Mousetrap = require('mousetrap');
katex = require('../lib/katex/katex-modified.min.js');
GuppyBackend = require('./guppy_backend.js');
GuppyUtils = require('./guppy_utils.js');

var Guppy = function(guppy_div, config){
    var self = this;
    var config = config || {};
    var events = config['events'] || {}
    var options = config['options'] || {};

    if(typeof guppy_div === 'string' || guppy_div instanceof String){
	guppy_div = document.getElementById(guppy_div);
    }
    
    // Set the id on the div if it is not currently set.
    if(!(guppy_div.id)){
	var i = Guppy.max_uid || 0;
	while(document.getElementById("guppy_uid_"+i)) i++;
	Guppy.max_uid = i;
	guppy_div.id = "guppy_uid_"+i;
    }
    var i = Guppy.max_tabIndex || 0;
    guppy_div.tabIndex = i;
    Guppy.max_tabIndex = i+1;
    
    this.editor_active = true;
    this.empty_content = "\\color{red}{[?]}"
    this.editor = guppy_div;
    this.blacklist = [];
    this.autoreplace = true;
    this.ready = false;

    this.events = {};
    
    Guppy.instances[guppy_div.id] = this;

    this.backend = new GuppyBackend(config);
    this.temp_cursor = {"node":null,"caret":0}
    this.editor.addEventListener("keydown",Guppy.key_down, false);
    this.editor.addEventListener("keyup",Guppy.key_up, false);
    this.editor.addEventListener("focus", function(e) { Guppy.kb.alt_down = false; if(self.activate) self.activate();}, false);
    if(Guppy.ready && !this.ready){
    	this.ready = true;
	console.log("ready");
    	this.backend.fire_event("ready");
	this.render(true);
    }
    this.deactivate();
    this.recompute_locations_paths();
}

Guppy.instances = {};
Guppy.ready = false;

Guppy.active_guppy = null;

Guppy.get_symbols = function(l){
    var all_ready = function(){
	Guppy.register_keyboard_handlers();
	for(var i in Guppy.instances){
	    Guppy.instances[i].ready = true;
	    Guppy.instances[i].render(true);
	    Guppy.instances[i].backend.fire_event("ready")
	    Guppy.instances[i].events["ready"] = null;
	}
	GuppyBackend.ready = true;
    }
    GuppyBackend.get_symbols(l,all_ready);
}

Guppy.prototype.is_changed = function(){
    var bb = this.editor.getElementsByClassName("katex")[0];
    if(!bb) return;
    var rect = bb.getBoundingClientRect();
    if(this.bounding_box)
	ans = this.bounding_box.top != rect.top || this.bounding_box.bottom != rect.bottom || this.bounding_box.right != rect.right || this.bounding_box.left != rect.left;
    else
	ans = true;
    this.bounding_box = rect;
    return ans;
}

Guppy.prototype.recompute_locations_paths = function(){
    ans = [];
    var bb = this.editor.getElementsByClassName("katex")[0];
    if(!bb) return;
    var rect = bb.getBoundingClientRect();
    ans.push({'path':'all',
	      'top':rect.top,
	      'bottom':rect.bottom,
	      'left':rect.left,
	      'right':rect.right});
    var elts = this.editor.getElementsByClassName("guppy_elt");
    for(var i = 0; i < elts.length; i++){
	var elt = elts[i];
	if(elt.nodeName == "mstyle") continue;
	var rect = elt.getBoundingClientRect();
	if(rect.top == 0 && rect.bottom == 0 && rect.left == 0 && rect.right == 0) continue;
	var cl = elt.classList;
	for(var j = 0; j < cl.length; j++){
	    if(cl[j].indexOf("guppy_loc") == 0){
		ans.push({'path':cl[j],
			  'top':rect.top,
			  'bottom':rect.bottom,
			  'left':rect.left,
			  'right':rect.right,
			  'mid_x':(rect.left+rect.right)/2,
			  'mid_y':(rect.bottom+rect.top)/2,
			  'blank':(' '+elt.className+' ').indexOf(' guppy_blank ') >= 0});
		break;
	    }
	}
    }
    this.boxes = ans;
}

Guppy.get_loc = function(x,y,current_node,current_caret){
    var g = Guppy.active_guppy;
    var min_dist = -1;
    var mid_dist = 0;
    var pos = "";
    var opt = null;
    var cur = null;
    var car = null;
    // check if we go to first or last element
    var bb = g.editor.getElementsByClassName("katex")[0];
    if(!bb) return;
    var rect = bb.getBoundingClientRect();
    if(current_node){
	var current_path = GuppyUtils.path_to(current_node);
	var current_pos = parseInt(current_path.substring(current_path.lastIndexOf("e")+1));
    }

    var boxes = g.boxes;
    if(!boxes) return;
    if(current_node){
	current_path = current_path.replace(/e[0-9]+$/,"e");
	var boxes2 = [];
	for(var i = 0; i < boxes.length; i++){
	    if(boxes[i].path == "all") continue;
	    var loc = boxes[i].path.substring(0,boxes[i].path.lastIndexOf("_"));
	    loc = loc.replace(/e[0-9]+$/,"e");
	    if(loc == current_path){
		boxes2.push(boxes[i]);
	    }
	}
	boxes = boxes2;
    }
    if(!boxes) return;
    for(var i = 0; i < boxes.length; i++){
	var box = boxes[i];
	if(box.path == "all"){
	    if(!opt) opt = {'path':'guppy_loc_m_e1_0'};
	    continue;
	}
	var xdist = Math.max(box.left - x, x - box.right, 0)
	var ydist = Math.max(box.top - y, y - box.bottom, 0)
	var dist = Math.sqrt(xdist*xdist + ydist*ydist);
	if(min_dist == -1 || dist < min_dist){
	    min_dist = dist;
	    mid_dist = x - box.mid_x;
	    opt = box;
	}
    }
    var loc = opt.path.substring("guppy_loc".length);
    loc = loc.replace(/_/g,"/");
    loc = loc.replace(/([0-9]+)(?=.*?\/)/g,"[$1]");
    cur = g.backend.doc.xpath_node(loc.substring(0,loc.lastIndexOf("/")), g.backend.doc.root());
    car = parseInt(loc.substring(loc.lastIndexOf("/")+1));
    // Check if we want the cursor before or after the element
    if(mid_dist > 0 && !(opt.blank)){
	car++;
    }
    ans = {"current":cur,"caret":car,"pos":pos};
    if(current_node && opt){
	var opt_pos = parseInt(opt.path.substring(opt.path.lastIndexOf("e")+1,opt.path.lastIndexOf("_")));
	if(opt_pos < current_pos) pos = "left";
	else if(opt_pos > current_pos) pos = "right";
	else if(car < current_caret) pos = "left";
	else if(car > current_caret) pos = "right";
	if(pos) ans['pos'] = pos;
	else ans['pos'] = "none";
    }
    return ans;
}

Guppy.mouse_up = function(e){
    Guppy.kb.is_mouse_down = false;
    var g = Guppy.active_guppy;
    if(g) g.render(true);
}

Guppy.mouse_down = function(e){
    var n = e.target;
    Guppy.kb.is_mouse_down = true;
    if(e.target == document.getElementById("toggle_ref")) toggle_div("help_card");
    else while(n != null){
	if(n.id in Guppy.instances){
	    e.preventDefault();
	    var prev_active = Guppy.active_guppy;
	    for(var i in Guppy.instances){
		if(i != n.id) Guppy.instances[i].deactivate();
		Guppy.active_guppy = Guppy.instances[n.id];
		Guppy.active_guppy.activate();
	    }
	    var g = Guppy.active_guppy;
	    var b = Guppy.active_guppy.backend;
	    g.space_caret = 0;
	    if(prev_active == g){
		if(e.shiftKey){
		    g.select_to(e.clientX, e.clientY, true);
		}
		else {
		    var loc = Guppy.get_loc(e.clientX,e.clientY);
		    if(!loc) return;
		    b.current = loc.current;
		    b.caret = loc.caret;
		    b.sel_status = GuppyBackend.SEL_NONE;
		}
		g.render(true);
	    }
	    return;
	}
	n = n.parentNode;
    }
    Guppy.active_guppy = null;
    for(var i in Guppy.instances){
	Guppy.instances[i].deactivate();
    }
}

Guppy.mouse_move = function(e){
    var g = Guppy.active_guppy;
    if(!g) return;
    if(!Guppy.kb.is_mouse_down){
	var bb = g.editor;
	var rect = bb.getBoundingClientRect();
	if((e.clientX < rect.left || e.clientX > rect.right) || (e.clientY > rect.bottom || e.clientY < rect.top)){
	    g.temp_cursor = {"node":null,"caret":0};
	}
	else{
	    var loc = Guppy.get_loc(e.clientX,e.clientY);
	    if(!loc) return;
	    g.temp_cursor = {"node":loc.current,"caret":loc.caret};
	}
	g.render(g.is_changed());
    }
    else{
	g.select_to(e.clientX,e.clientY, true);
	g.render(g.is_changed());
    }
}

Guppy.prototype.select_to = function(x, y, mouse){
    var sel_caret = this.backend.caret;
    var sel_cursor = this.backend.current;
    if(this.backend.sel_status == GuppyBackend.SEL_CURSOR_AT_START){
	sel_cursor = this.backend.sel_end.node;
	sel_caret = this.backend.sel_end.caret;
    }
    else if(this.backend.sel_status == GuppyBackend.SEL_CURSOR_AT_END){
	sel_cursor = this.backend.sel_start.node;
	sel_caret = this.backend.sel_start.caret;
    }
    var loc = Guppy.get_loc(x,y,sel_cursor,sel_caret);
    if(!loc) return;
    this.backend.select_to(loc, sel_cursor, sel_caret, mouse);
}


window.addEventListener("mousedown",Guppy.mouse_down, false);
window.addEventListener("mouseup",Guppy.mouse_up, false);
window.addEventListener("mousemove",Guppy.mouse_move, false);

Guppy.prototype.render_node = function(t){
    // All the interesting work is done by transform.  This function just adds in the cursor and selection-start cursor
    var output = "";
    if(t == "render"){
	var root = this.backend.doc.root();
	this.backend.add_paths(root,"m");
	//console.log("C1",(new XMLSerializer()).serializeToString(this.backend.doc.base));
	this.backend.temp_cursor = this.temp_cursor;
	this.backend.add_classes_cursors(root);
	//console.log("C2",(new XMLSerializer()).serializeToString(this.backend.doc.base));
	this.backend.current.setAttribute("current","yes");
	if(this.temp_cursor.node) this.temp_cursor.node.setAttribute("temp","yes");
	//console.log("C3",(new XMLSerializer()).serializeToString(this.backend.doc.base));
	output = this.backend.get_content("latex",true);
	this.backend.remove_cursors_classes(root);
	output = output.replace(new RegExp('&amp;','g'), '&');
	//console.log("OUTPUT",output);
	return output;
    }
    else{
	output = this.backend.get_content(t);
    }
    return output
}

Guppy.prototype.render = function(updated){
    if(!this.editor_active && GuppyUtils.is_blank(this.backend.doc.root())){
	katex.render(this.empty_content,this.editor);
	return;
    }
    var tex = this.render_node("render");
    //console.log("TEX",tex);
    //this.fire_event("debug",{"message":"RENDERING: " + tex})
    katex.render(tex,this.editor);
    if(updated){
	this.recompute_locations_paths();
    }
}

Guppy.prototype.activate = function(){
    Guppy.active_guppy = this;
    this.editor_active = true;
    this.editor.className = this.editor.className.replace(new RegExp('(\\s|^)guppy_inactive(\\s|$)'),' guppy_active ');
    this.editor.focus();
    if(this.ready){
	this.render(true);
	//this.fire_event("focus",{"focused":true});
    }
}

Guppy.prototype.deactivate = function(){
    this.editor_active = false;
    var r1 = new RegExp('(?:\\s|^)guppy_active(?:\\s|$)');
    var r2 = new RegExp('(?:\\s|^)guppy_inactive(?:\\s|$)');
    if(this.editor.className.match(r1)){
	this.editor.className = this.editor.className.replace(r1,' guppy_inactive ');
    }
    else if(!this.editor.className.match(r2)){
	this.editor.className += ' guppy_inactive ';
    }
    Guppy.kb.shift_down = false;
    Guppy.kb.ctrl_down = false;
    Guppy.kb.alt_down = false;
    if(this.ready){
	this.render();
	//this.fire_event("focus",{"focused":false});
    }
}


// Keyboard stuff

Guppy.kb = {};

Guppy.kb.is_mouse_down = false;

/* keyboard behaviour definitions */

// keys aside from 0-9,a-z,A-Z
Guppy.kb.k_chars = {
    "=":"=",
    "+":"+",
    "-":"-",
    "*":"*",
    ".":".",
    ",":",",
    "shift+/":"/",
    "shift+=":"+",
    "!":"!"
};
Guppy.kb.k_syms = {
    "/":"slash",
    "^":"exp",
    "*":"*",
    "(":"paren",
    "<":"less",
    ">":"greater",
    "_":"sub",
    "|":"abs",
    "shift+up":"exp",
    "shift+down":"sub"
};
Guppy.kb.k_controls = {
    "up":"up",
    "down":"down",
    "right":"right",
    "left":"left",
    "alt+k":"up",
    "alt+j":"down",
    "alt+l":"right",
    "alt+h":"left",
    "space":"spacebar",
    "home":"home",
    "end":"end",
    "backspace":"backspace",
    "del":"delete_key",
    "mod+a":"sel_all",
    "mod+c":"sel_copy",
    "mod+x":"sel_cut",
    "mod+v":"sel_paste",
    "mod+z":"undo",
    "mod+y":"redo",
    "enter":"done",
    "mod+shift+right":"list_extend_copy_right",
    "mod+shift+left":"list_extend_copy_left",
    "mod+right":"list_extend_right",
    "mod+left":"list_extend_left",
    "mod+up":"list_extend_up",
    "mod+down":"list_extend_down",
    "mod+shift+up":"list_extend_copy_up",
    "mod+shift+down":"list_extend_copy_down",
    "mod+backspace":"list_remove",
    "mod+shift+backspace":"list_remove_row",
    "shift+left":"sel_left",
    "shift+right":"sel_right",
    ")":"right_paren",
    "\\":"backslash",
    "tab":"tab"
};

// letters

for(var i = 65; i <= 90; i++){
    Guppy.kb.k_chars[String.fromCharCode(i).toLowerCase()] = String.fromCharCode(i).toLowerCase();
    Guppy.kb.k_chars['shift+'+String.fromCharCode(i).toLowerCase()] = String.fromCharCode(i).toUpperCase();
}

// numbers

for(var i = 48; i <= 57; i++)
    Guppy.kb.k_chars[String.fromCharCode(i)] = String.fromCharCode(i);

Guppy.register_keyboard_handlers = function(){
    Mousetrap.addKeycodes({173: '-'}); // Firefox's special minus (needed for _ = sub binding)
    var self = this;
    for(var i in Guppy.kb.k_chars)
    	Mousetrap.bind(i,function(i){ return function(){
	    if(!Guppy.active_guppy) return true;
	    Guppy.active_guppy.temp_cursor.node = null;
	    Guppy.active_guppy.backend.insert_string(Guppy.kb.k_chars[i]);
	    Guppy.active_guppy.render(true);
	    return false;
	}}(i));  
    for(var i in Guppy.kb.k_syms)
    	Mousetrap.bind(i,function(i){ return function(){
	    if(!Guppy.active_guppy) return true;
	    Guppy.active_guppy.temp_cursor.node = null;
	    Guppy.active_guppy.backend.space_caret = 0;
	    Guppy.active_guppy.backend.insert_symbol(Guppy.kb.k_syms[i]);
	    Guppy.active_guppy.render(true);
	    return false;
	}}(i));
    for(var i in Guppy.kb.k_controls)
    	Mousetrap.bind(i,function(i){ return function(){
	    if(!Guppy.active_guppy) return true;
	    Guppy.active_guppy.backend.space_caret = 0;
	    Guppy.active_guppy.backend[Guppy.kb.k_controls[i]]();
	    Guppy.active_guppy.temp_cursor.node = null;
	    Guppy.active_guppy.render(["up","down","right","left","home","end","sel_left","sel_right"].indexOf(i) < 0);
	    Guppy.active_guppy.render(false);
	    return false;
	}}(i));
}

module.exports = Guppy;
