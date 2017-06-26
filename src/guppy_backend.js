Mousetrap = require('mousetrap');
katex = require('../lib/katex/katex-modified.min.js');
GuppyUtil = require('./guppy_utils.js');
GuppyDoc = require('./guppy_doc.js');
GuppySymbols = require('./guppy_symbols.js');

String.prototype.splice = function(idx, s){ return (this.slice(0,idx) + s + this.slice(idx)); };
String.prototype.splicen = function(idx, s, n){ return (this.slice(0,idx) + s + this.slice(idx+n));};
String.prototype.search_at = function(idx, s){ return (this.substring(idx-s.length,idx) == s); };

var GuppyBackend = function(config){
    var self = this;
    var config = config || {};
    var events = config['events'] || {};
    var options = config['options'] || {};

    this.blacklist = [];
    this.autoreplace = true;
    this.ready = false;
    this.events = {};
    this.symbols = {};

    var evts = ["ready", "change", "left_end", "right_end", "done", "completion", "debug", "error", "focus"];

    for(var i = 0; i < evts.length; i++){
	var e = evts[i];
	if(e in events) this.events[e] = e in events ? events[e] : null;
    }

    var opts = ["blank_caret", "empty_content", "blacklist", "autoreplace"];

    for(var i = 0; i < opts.length; i++){
	var p = opts[i];
	if(p in options) this[p] = options[p];
    }

    this.doc = new GuppyDoc();

    this.clipboard = null;
    this.current = this.doc.root().firstChild;
    this.caret = 0;
    this.space_caret = 0;
    this.sel_start = null;
    this.sel_end = null;
    this.undo_data = [];
    this.undo_now = -1;
    this.sel_status = GuppyBackend.SEL_NONE;
    this.checkpoint();
    if(GuppyBackend.ready && !this.ready){
    	this.ready = true;
    	this.fire_event("ready");
    }
}

GuppyBackend.SEL_NONE = 0;
GuppyBackend.SEL_CURSOR_AT_START = 1;
GuppyBackend.SEL_CURSOR_AT_END = 2;

GuppyBackend.get_symbols = function(l, cb){
    GuppySymbols.get_symbols(l,cb);
}

GuppyBackend.prototype.get_content = function(t,r){
    return this.doc.get_content(t,r);
}

GuppyBackend.prototype.set_content = function(xml_data){
    this.doc = new GuppyDoc(xml_data);
    this.clipboard = null;
    this.current = this.doc.root().firstChild;
    this.caret = 0;
    this.sel_start = null;
    this.sel_end = null;
    this.undo_data = [];
    this.undo_now = -1;
    this.sel_status = GuppyBackend.SEL_NONE;
    this.checkpoint();
}

GuppyBackend.prototype.fire_event = function(event, args){
    if(this.events[event]) this.events[event](args);
}

GuppyBackend.prototype.select_to = function(loc, sel_cursor, sel_caret, mouse){
    if(loc.current == sel_cursor && loc.caret == sel_caret){
	this.current = loc.current;
	this.caret = loc.caret;
	this.sel_status = GuppyBackend.SEL_NONE;
    }
    else if(loc.pos == "left"){
	this.sel_end = {"node":sel_cursor,"caret":sel_caret};
	this.current = loc.current;
	this.caret = loc.caret;
	this.set_sel_boundary(GuppyBackend.SEL_CURSOR_AT_START, mouse);
    }
    else if(loc.pos == "right"){
	this.sel_start = {"node":sel_cursor,"caret":sel_caret};
	this.current = loc.current;
	this.caret = loc.caret;
	this.set_sel_boundary(GuppyBackend.SEL_CURSOR_AT_END, mouse);
    }
}

GuppyBackend.prototype.set_sel_start = function(){
    this.sel_start = {"node":this.current, "caret":this.caret};
}

GuppyBackend.prototype.set_sel_end = function(){
    this.sel_end = {"node":this.current, "caret":this.caret};
}

GuppyBackend.prototype.add_paths = function(n,path){
    if(n.nodeName == "e"){
	n.setAttribute("path",path);
    }
    else{
	var es = 1, fs = 1, cs = 1, ls = 1;
	for(var c = n.firstChild; c != null; c = c.nextSibling){
	    if(c.nodeName == "c"){ this.add_paths(c, path+"_c"+cs); cs++; }
	    else if(c.nodeName == "f"){ this.add_paths(c, path+"_f"+fs); fs++; }
	    else if(c.nodeName == "l"){ this.add_paths(c, path+"_l"+ls); ls++; }
	    else if(c.nodeName == "e"){ this.add_paths(c, path+"_e"+es); es++; }
	}
    }
}

GuppyBackend.prototype.add_classes_cursors = function(n,path){
    if(n.nodeName == "e"){
	var text = n.firstChild.nodeValue;
	ans = "";
	var sel_cursor;
	var text_node = GuppyUtils.is_text(n);
	if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_START) sel_cursor = this.sel_end;
	if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_END) sel_cursor = this.sel_start;
	if(this.sel_status != GuppyBackend.SEL_NONE){
	    var sel_caret_text = GuppyUtils.is_small(sel_cursor.node) ? GuppyUtils.SMALL_SEL_CARET : GuppyUtils.SEL_CARET;
	    if(!text_node && text.length == 0 && n.parentNode.childElementCount > 1){
		sel_caret_text = "\\color{blue}{\\xmlClass{guppy_elt guppy_blank guppy_loc_"+n.getAttribute("path")+"_0}{"+sel_caret_text+"}}";
	    }
	    else{
		sel_caret_text = "\\color{blue}{"+sel_caret_text+"}";
	    }
	    if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_END) sel_caret_text = text_node ? "[" : sel_caret_text + "\\color{"+GuppyUtils.SEL_COLOR+"}{";
	    if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_START) sel_caret_text = text_node ? "]" : "}" + sel_caret_text;
	}
	var caret_text = "";
	var temp_caret_text = "";
	if(text.length == 0){
	    if(text_node) caret_text = "\\_";
	    else if(n.parentNode.childElementCount == 1){
		if(this.current == n){
		    var blank_caret = this.blank_caret || (GuppyUtils.is_small(this.current) ? GuppyUtils.SMALL_CARET : GuppyUtils.CARET);
		    ans = "\\color{red}{\\xmlClass{main_cursor guppy_elt guppy_blank guppy_loc_"+n.getAttribute("path")+"_0"+"}{"+blank_caret+"}}";
		}
		else if(this.temp_cursor.node == n)
		    ans = "\\color{gray}{\\xmlClass{guppy_elt guppy_blank guppy_loc_"+n.getAttribute("path")+"_0"+"}{[?]}}";
		else
		    ans = "\\color{blue}{\\xmlClass{guppy_elt guppy_blank guppy_loc_"+n.getAttribute("path")+"_0"+"}{[?]}}";
	    }
	    else if(this.temp_cursor.node != n && this.current != n && (!(sel_cursor) || sel_cursor.node != n)){
		// These are the empty e elements at either end of
		// a c or m node, such as the space before and
		// after both the sin and x^2 in sin(x^2)
		//
		// Here, we add in a small element so that we can
		// use the mouse to select these areas
		ans = "\\phantom{\\xmlClass{guppy_elt guppy_blank guppy_loc_"+n.getAttribute("path")+"_0"+"}{\\cursor[0.1ex]{1ex}}}";
	    }
	}
	for(var i = 0; i < text.length+1; i++){
	    if(n == this.current && i == this.caret && (text.length > 0 || n.parentNode.childElementCount > 1)){
		if(text_node){
		    if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_START)
			caret_text = "[";
		    else if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_END)
			caret_text = "]";
		    else
			caret_text = "\\_";
		}
		else{
		    caret_text = GuppyUtils.is_small(this.current) ? GuppyUtils.SMALL_CARET : GuppyUtils.CARET;
		    if(text.length == 0)
			caret_text = "\\color{red}{\\xmlClass{main_cursor guppy_elt guppy_blank guppy_loc_"+n.getAttribute("path")+"_0}{"+caret_text+"}}";
		    else{
			caret_text = "\\color{red}{\\xmlClass{main_cursor}{"+caret_text+"}}"
		    }
		    if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_START)
			caret_text = caret_text + "\\color{"+GuppyUtils.SEL_COLOR+"}{";
		    else if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_END)
			caret_text = "}" + caret_text;
		}
		ans += caret_text;
	    }
	    else if(n == this.current && i == this.caret && text_node){
		ans += caret_text;
	    }
	    else if(this.sel_status != GuppyBackend.SEL_NONE && sel_cursor.node == n && i == sel_cursor.caret){
		ans += sel_caret_text;
	    }
	    else if(this.temp_cursor.node == n && i == this.temp_cursor.caret && (text.length > 0 || n.parentNode.childElementCount > 1)){
		if(text_node)
		    temp_caret_text = ".";
		else{
		    temp_caret_text = GuppyUtils.is_small(this.current) ? GuppyUtils.TEMP_SMALL_CARET : GuppyUtils.TEMP_CARET;
		    if(text.length == 0){
			temp_caret_text = "\\color{gray}{\\xmlClass{guppy_elt guppy_blank guppy_loc_"+n.getAttribute("path")+"_0}{"+temp_caret_text+"}}";
		    }
		    else
			temp_caret_text = "\\color{gray}{"+temp_caret_text+"}";
		}
		ans += temp_caret_text;
	    }
	    if(i < text.length) ans += "\\xmlClass{guppy_elt guppy_loc_"+n.getAttribute("path")+"_"+i+"}{"+text[i]+"}";
	}
	n.setAttribute("render", ans);
	n.removeAttribute("path");
    }
    else{
	for(var c = n.firstChild; c != null; c = c.nextSibling){
	    if(c.nodeName == "c" || c.nodeName == "l" || c.nodeName == "f" || c.nodeName == "e"){ this.add_classes_cursors(c); }
	}
    }
}

GuppyBackend.prototype.remove_cursors_classes = function(n){
    if(n.nodeName == "e"){
	n.removeAttribute("path");
	n.removeAttribute("render");
	n.removeAttribute("current");
	n.removeAttribute("temp");
    }
    else{
	for(var c = n.firstChild; c != null; c = c.nextSibling){
	    if(c.nodeType == 1){ this.remove_cursors_classes(c); }
	}
    }
}

GuppyBackend.prototype.down_from_f = function(){
    var nn = this.current.firstChild;
    while(nn != null && nn.nodeName != 'c' && nn.nodeName != 'l') nn = nn.nextSibling;
    if(nn != null){
	while(nn.nodeName == 'l') nn = nn.firstChild;
	this.current = nn.firstChild;
    }
}

GuppyBackend.prototype.down_from_f_to_blank = function(){
    var nn = this.current.firstChild;
    while(nn != null && !(nn.nodeName == 'c' && nn.children.length == 1 && nn.firstChild.firstChild.nodeValue == "")){
	nn = nn.nextSibling;
    }
    if(nn != null){
	//Sanity check:

	while(nn.nodeName == 'l') nn = nn.firstChild;
	if(nn.nodeName != 'c' || nn.firstChild.nodeName != 'e'){
	    this.problem('dfftb');
	    return;
	}
	this.current = nn.firstChild;
    }
    else this.down_from_f();
}

GuppyBackend.prototype.delete_from_f = function(to_insert){
    var n = this.current;
    var p = n.parentNode;
    var prev = n.previousSibling;
    var next = n.nextSibling;
    var middle = to_insert || "";
    var new_node = this.make_e(prev.firstChild.textContent + middle + next.firstChild.textContent);
    this.current = new_node;
    this.caret = prev.firstChild.textContent.length;
    p.insertBefore(new_node, prev);
    p.removeChild(prev);
    p.removeChild(n);
    p.removeChild(next);
}

GuppyBackend.prototype.symbol_to_node = function(sym_name, content){
    // sym_name is a key in the symbols dictionary
    //
    // content is a list of nodes to insert
    var base = this.doc.base;
    var s;
    if(sym_name in this.symbols){
      s = this.symbols[sym_name];
    }else{
      s = GuppySymbols.symbols[sym_name];
    }
    var f = base.createElement("f");
    if("type" in s) f.setAttribute("type",s["type"])
    if(s['char']) f.setAttribute("c","yes");

    var first_ref = -1;
    var refs_count = 0;
    var lists = {}
    var first;

    // Make the b nodes for rendering each output
    for(var t in s["output"]){
	var b = base.createElement("b");
	b.setAttribute("p",t);

	var out = s["output"][t];
	if(typeof out == 'string'){
	    out = out.split(/(\{\$[0-9]+(?:\{[^}]+\})*\})/g);
	    for(var i = 0; i < out.length; i++){
		m = out[i].match(/^\{\$([0-9]+)((?:\{[^}]+\})*)\}$/);
		if(m){
		    //console.log("O",out);
		    out[i] = {'ref':parseInt(m[1])};
		    if(m[2].length > 0){
			mm = m[2].match(/\{[^}]*\}/g);
			out[i]['d'] = mm.length;
			for(var j = 0; j < mm.length; j++){
			    out[i]['sep'+j] = mm[j].substring(1,mm[j].length-1);
			}
		    }
		}
	    }
	}
	for(var i = 0; i < out.length; i++){
	    if(typeof out[i] == 'string' || out[i] instanceof String){
		var nt = base.createTextNode(out[i]);
		b.appendChild(nt);
	    }
	    else{
		var nt = base.createElement("r");
		for(var attr in out[i]){
		    nt.setAttribute(attr,out[i][attr]);
		}
		if(t == 'latex') {
		    if(first_ref == -1) first_ref = out[i]['ref'];
		    if('d' in out[i]) lists[refs_count] = out[i]['d']
		    refs_count++;
		}
		b.appendChild(nt);
	    }
	}
	f.appendChild(b);
    }
    // Now make the c nodes for storing the content
    for(var i = 0; i < refs_count; i++){
	var nc = base.createElement("c");
	if(i in content){
	    var node_list = content[i];
	    for(var se = 0; se < node_list.length; se++){
		nc.appendChild(node_list[se].cloneNode(true));
	    }
	}
	else nc.appendChild(this.make_e(""));
	if(i+1 == first_ref) first = nc.lastChild;
	for(var a in s['attrs'])
	    if(s['attrs'][a][i] != 0) nc.setAttribute(a,s['attrs'][a][i]);
	if(i in lists){
	    var par = f;
	    for(var j = 0; j < lists[i]; j++){
		var nl = base.createElement("l");
		nl.setAttribute("s","1");
		par.appendChild(nl);
		par = nl;
		if(j == lists[i]-1) nl.appendChild(nc);
	    }
	}
	else f.appendChild(nc);
    }
    return {"f":f, "first":first};
}

GuppyBackend.prototype.insert_symbol = function(sym_name){
    var s;
    if(sym_name in this.symbols){
      s = this.symbols[sym_name];
    }else{
      s = GuppySymbols.symbols[sym_name];
    }
    if(this.is_blacklisted(s['type'])){
	return false;
    }
    var node_list = {};
    var content = {};
    var left_piece,right_piece;
    var cur = s['current'] == null ? 0 : parseInt(s['current']);
    var to_remove = [];
    var to_replace = null;
    var replace_f = false;


    if(cur > 0){
	cur--;
	if(this.sel_status != GuppyBackend.SEL_NONE){
	    var sel = this.sel_get();
	    sel_parent = sel.involved[0].parentNode;
	    to_remove = sel.involved;
	    left_piece = this.make_e(sel.remnant.firstChild.nodeValue.slice(0,this.sel_start.caret));
	    right_piece = this.make_e(sel.remnant.firstChild.nodeValue.slice(this.sel_start.caret));
	    content[cur] = sel.node_list;
	}
	else if(s['current_type'] == 'token'){
	    // If we're at the beginning, then the token is the previous f node
	    if(this.caret == 0 && this.current.previousSibling != null){
		content[cur] = [this.make_e(""), this.current.previousSibling, this.make_e("")];
		to_replace = this.current.previousSibling;
		replace_f = true;
	    }
	    else{
		// look for [0-9.]+|[a-zA-Z] immediately preceeding the caret and use that as token
		var prev = this.current.firstChild.nodeValue.substring(0,this.caret);
		var token = prev.match(/[0-9.]+$|[a-zA-Z]$/);
		if(token != null && token.length > 0){
		    token = token[0];
		    left_piece = this.make_e(this.current.firstChild.nodeValue.slice(0,this.caret-token.length));
		    right_piece = this.make_e(this.current.firstChild.nodeValue.slice(this.caret));
		    content[cur] = [this.make_e(token)];
		}
	    }
	}
    }
    if(!replace_f && (left_piece == null || right_piece == null)){
	left_piece = this.make_e(this.current.firstChild.nodeValue.slice(0,this.caret));
	right_piece = this.make_e(this.current.firstChild.nodeValue.slice(this.caret));
	to_remove = [this.current];
    }

    // By now:
    //
    // content contains whatever we want to pre-populate the 'current' field with (if any)
    //
    // right_piece contains whatever content was in an involved node
    // to the right of the cursor but is not part of the insertion.
    // Analogously for left_piece
    //
    // Thus all we should have to do now is symbol_to_node(sym_type,
    // content) and then add the left_piece, resulting node, and
    // right_piece in that order.

    var new_current = null;
    var current_parent = this.current.parentNode;

    var sym = this.symbol_to_node(sym_name,content);
    var f = sym.f;
    var new_current = sym.first;

    var next = this.current.nextSibling;

    if(replace_f){
	current_parent.replaceChild(f,to_replace);
    }
    else{
	if(to_remove.length == 0) this.current.parentNode.removeChild(this.current);

	for(var i = 0; i < to_remove.length; i++){
	    if(next == to_remove[i]) next = next.nextSibling;
	    current_parent.removeChild(to_remove[i]);
	}
	current_parent.insertBefore(left_piece, next);
	current_parent.insertBefore(f, next);
	current_parent.insertBefore(right_piece, next);
    }

    this.caret = 0;
    this.current = f;
    if(s['char']){
	this.current = this.current.nextSibling;
    }
    else this.down_from_f_to_blank();

    this.sel_clear();
    this.checkpoint();
    return true;
}

GuppyBackend.prototype.sel_get = function(){
    if(this.sel_status == GuppyBackend.SEL_NONE){
	return null;
    }
    var involved = [];
    var node_list = [];
    var remnant = null;

    if(this.sel_start.node == this.sel_end.node){
	return {"node_list":[this.make_e(this.sel_start.node.firstChild.nodeValue.substring(this.sel_start.caret, this.sel_end.caret))],
		"remnant":this.make_e(this.sel_start.node.firstChild.nodeValue.substring(0, this.sel_start.caret) + this.sel_end.node.firstChild.nodeValue.substring(this.sel_end.caret)),
		"involved":[this.sel_start.node]};
    }

    node_list.push(this.make_e(this.sel_start.node.firstChild.nodeValue.substring(this.sel_start.caret)));
    involved.push(this.sel_start.node);
    involved.push(this.sel_end.node);
    remnant = this.make_e(this.sel_start.node.firstChild.nodeValue.substring(0, this.sel_start.caret) + this.sel_end.node.firstChild.nodeValue.substring(this.sel_end.caret));
    var n = this.sel_start.node.nextSibling;
    while(n != null && n != this.sel_end.node){
	involved.push(n);
	node_list.push(n);
	n = n.nextSibling;
    }
    node_list.push(this.make_e(this.sel_end.node.firstChild.nodeValue.substring(0, this.sel_end.caret)));
    return {"node_list":node_list,
	    "remnant":remnant,
	    "involved":involved,
	    "cursor":0};
}

// GuppyBackend.prototype.print_selection = function(){
//     var sel = this.sel_get();
//     if(sel == null) return "[none]";
//     var ans = "";
//     ans += "node_list: \n";
//     for(var i = 0; i < sel.node_list.length; i++){
// 	var n = sel.node_list[i];
// 	ans += (new XMLSerializer()).serializeToString(n) + "\n";
//     }
//     ans += "\ninvolved: \n";
//     for(var i = 0; i < sel.involved.length; i++){
// 	var n = sel.involved[i];
// 	ans += (new XMLSerializer()).serializeToString(n) + "\n";
//     }
// }

GuppyBackend.prototype.make_e = function(text){
    var base = this.doc.base;
    var new_node = base.createElement("e");
    new_node.appendChild(base.createTextNode(text));
    return new_node;
}

GuppyBackend.prototype.insert_string = function(s){
    if(this.sel_status != GuppyBackend.SEL_NONE){
	this.sel_delete();
	this.sel_clear();
    }
    this.current.firstChild.nodeValue = this.current.firstChild.nodeValue.splice(this.caret,s)
    this.caret += s.length;
    this.checkpoint();
    if(this.autoreplace) this.check_for_symbol();
}

GuppyBackend.prototype.sel_copy = function(){
    var sel = this.sel_get();
    if(!sel) return;
    this.clipboard = [];
    for(var i = 0; i < sel.node_list.length; i++){
	this.clipboard.push(sel.node_list[i].cloneNode(true));
    }
    this.sel_clear();
}

GuppyBackend.prototype.sel_cut = function(){
    var node_list = this.sel_delete();
    if(!node_list) return;
    this.clipboard = [];
    for(var i = 0; i < node_list.length; i++){
	this.clipboard.push(node_list[i].cloneNode(true));
    }
    this.sel_clear();
    this.checkpoint();
}

GuppyBackend.prototype.insert_nodes = function(node_list, move_cursor){
    var real_clipboard = [];
    for(var i = 0; i < node_list.length; i++){
	real_clipboard.push(node_list[i].cloneNode(true));
    }

    if(real_clipboard.length == 1){
	this.current.firstChild.nodeValue = this.current.firstChild.nodeValue.substring(0,this.caret) + real_clipboard[0].firstChild.nodeValue + this.current.firstChild.nodeValue.substring(this.caret);
	if(move_cursor) this.caret += real_clipboard[0].firstChild.nodeValue.length;
    }
    else{
	var nn = this.make_e(real_clipboard[real_clipboard.length-1].firstChild.nodeValue + this.current.firstChild.nodeValue.substring(this.caret));
	this.current.firstChild.nodeValue = this.current.firstChild.nodeValue.substring(0,this.caret) + real_clipboard[0].firstChild.nodeValue;
	if(this.current.nextSibling == null)
	    this.current.parentNode.appendChild(nn)
	else
	    this.current.parentNode.insertBefore(nn, this.current.nextSibling)
	for(var i = 1; i < real_clipboard.length - 1; i++)
	    this.current.parentNode.insertBefore(real_clipboard[i], nn);
	if(move_cursor){
	    this.current = nn;
	    this.caret = real_clipboard[real_clipboard.length-1].firstChild.nodeValue.length
	}
    }
}

GuppyBackend.prototype.sel_paste = function(){
    this.sel_delete();
    this.sel_clear();
    if(!(this.clipboard) || this.clipboard.length == 0) return;
    this.insert_nodes(this.clipboard, true);
    this.checkpoint();
    return;
}

GuppyBackend.prototype.sel_clear = function(){
    this.sel_start = null;
    this.sel_end = null;
    this.sel_status = GuppyBackend.SEL_NONE;
}

GuppyBackend.prototype.sel_delete = function(){
    var sel = this.sel_get();
    if(!sel) return null;
    sel_parent = sel.involved[0].parentNode;
    sel_prev = sel.involved[0].previousSibling;
    for(var i = 0; i < sel.involved.length; i++){
	var n = sel.involved[i];
	sel_parent.removeChild(n);
    }
    if(sel_prev == null){
	if(sel_parent.firstChild == null)
	    sel_parent.appendChild(sel.remnant);
	else
	    sel_parent.insertBefore(sel.remnant, sel_parent.firstChild);
    }
    else if(sel_prev.nodeName == 'f'){
	if(sel_prev.nextSibling == null)
	    sel_parent.appendChild(sel.remnant);
	else
	    sel_parent.insertBefore(sel.remnant, sel_prev.nextSibling);
    }
    this.current = sel.remnant
    this.caret = this.sel_start.caret;
    return sel.node_list;
}

GuppyBackend.prototype.sel_all = function(){
    this.home();
    this.set_sel_start();
    this.end();
    this.set_sel_end();
    if(this.sel_start.node != this.sel_end.node || this.sel_start.caret != this.sel_end.caret)
	this.sel_status = GuppyBackend.SEL_CURSOR_AT_END;
}

GuppyBackend.prototype.sel_right = function(){
    if(this.sel_status == GuppyBackend.SEL_NONE){
	this.set_sel_start();
	this.sel_status = GuppyBackend.SEL_CURSOR_AT_END;
    }
    if(this.caret >= GuppyUtils.get_length(this.current)){
	var nn = this.current.nextSibling;
	if(nn != null){
	    this.current = nn.nextSibling;
	    this.caret = 0;
	    this.set_sel_boundary(GuppyBackend.SEL_CURSOR_AT_END);
	}
	else{
	    this.set_sel_boundary(GuppyBackend.SEL_CURSOR_AT_END);
	}
    }
    else{
	this.caret += 1;
	this.set_sel_boundary(GuppyBackend.SEL_CURSOR_AT_END);
    }
    if(this.sel_start.node == this.sel_end.node && this.sel_start.caret == this.sel_end.caret){
	this.sel_status = GuppyBackend.SEL_NONE;
    }
}

GuppyBackend.prototype.set_sel_boundary = function(sstatus, mouse){
    if(this.sel_status == GuppyBackend.SEL_NONE || mouse) this.sel_status = sstatus;
    if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_START)
	this.set_sel_start();
    else if(this.sel_status == GuppyBackend.SEL_CURSOR_AT_END)
	this.set_sel_end();
}

GuppyBackend.prototype.sel_left = function(){
    if(this.sel_status == GuppyBackend.SEL_NONE){
	this.set_sel_end();
	this.sel_status = GuppyBackend.SEL_CURSOR_AT_START;
    }
    if(this.caret <= 0){
	var nn = this.current.previousSibling;
	if(nn != null){
	    this.current = nn.previousSibling;
	    this.caret = this.current.firstChild.nodeValue.length;
	    this.set_sel_boundary(GuppyBackend.SEL_CURSOR_AT_START);
	}
	else{
	    this.set_sel_boundary(GuppyBackend.SEL_CURSOR_AT_START);
	}
    }
    else{
	this.caret -= 1;
	this.set_sel_boundary(GuppyBackend.SEL_CURSOR_AT_START);
    }
    if(this.sel_start.node == this.sel_end.node && this.sel_start.caret == this.sel_end.caret){
	this.sel_status = GuppyBackend.SEL_NONE;
    }
}

GuppyBackend.prototype.list_extend_copy_right = function(){this.list_extend("right", true);}
GuppyBackend.prototype.list_extend_copy_left = function(){this.list_extend("left", true);}
GuppyBackend.prototype.list_extend_right = function(){this.list_extend("right", false);}
GuppyBackend.prototype.list_extend_left = function(){this.list_extend("left", false);}
GuppyBackend.prototype.list_extend_up = function(){this.list_extend("up", false);}
GuppyBackend.prototype.list_extend_down = function(){this.list_extend("down", false);}
GuppyBackend.prototype.list_extend_copy_up = function(){this.list_extend("up", true);}
GuppyBackend.prototype.list_extend_copy_down = function(){this.list_extend("down", true);}

GuppyBackend.prototype.list_vertical_move = function(down){
    var n = this.current;
    while(n.parentNode && n.parentNode.parentNode && !(n.nodeName == 'c' && n.parentNode.nodeName == 'l' && n.parentNode.parentNode.nodeName == 'l')){
	n = n.parentNode;
    }
    if(!n.parentNode) return;
    var pos = 1;
    var cc = n;
    while(cc.previousSibling != null){
	pos++;
	cc = cc.previousSibling;
    }
    var new_l = down ? n.parentNode.nextSibling : n.parentNode.previousSibling
    if(!new_l) return;
    var idx = 1;
    var nn = new_l.firstChild;
    while(idx < pos){
	idx++;
	nn = nn.nextSibling;
    }
    this.current = nn.firstChild;
    this.caret = down ? 0 : this.current.firstChild.textContent.length;
}

GuppyBackend.prototype.list_extend = function(direction, copy){
    var base = this.doc.base;
    var vertical = direction == "up" || direction == "down";
    var before = direction == "up" || direction == "left";
    var this_name = vertical ? "l" : "c";
    var n = this.current;
    while(n.parentNode && !(n.nodeName == this_name && n.parentNode.nodeName == 'l')){
	n = n.parentNode;
    }
    if(!n.parentNode) return;
    var to_insert;

    // check if 2D and horizontal and extend all the other rows if so
    if(!vertical && n.parentNode.parentNode.nodeName == "l"){
	to_insert = base.createElement("c");
	to_insert.appendChild(this.make_e(""));
	var pos = 1;
	var cc = n;
	while(cc.previousSibling != null){
	    pos++;
	    cc = cc.previousSibling;
	}
	var to_modify = [];
	var iterator = this.doc.xpath_list("./l/c[position()="+pos+"]", n.parentNode.parentNode);
	try{ for(var nn = iterator.iterateNext(); nn != null; nn = iterator.iterateNext()){ to_modify.push(nn); }}
	catch(e) { this.fire_event("error",{"message":'XML modified during iteration? ' + e}); }
	for(var j = 0; j < to_modify.length; j++){
	    var nn = to_modify[j];
	    if(copy) nn.parentNode.insertBefore(nn.cloneNode(true), before ? nn : nn.nextSibling);
	    else nn.parentNode.insertBefore(to_insert.cloneNode(true), before ? nn : nn.nextSibling);
	    nn.parentNode.setAttribute("s",parseInt(nn.parentNode.getAttribute("s"))+1);
	}
	this.current = before ? n.previousSibling.lastChild : n.nextSibling.firstChild;
	this.caret = this.current.firstChild.textContent.length;
	this.checkpoint();
	return;
    }

    if(copy){
	to_insert = n.cloneNode(true);
    }
    else{
	if(vertical){
	    to_insert = base.createElement("l");
	    to_insert.setAttribute("s",n.getAttribute("s"))
	    for(var i = 0; i < parseInt(n.getAttribute("s")); i++){
		var c = base.createElement("c");
		c.appendChild(this.make_e(""));
		to_insert.appendChild(c);
	    }
	}
	else{
	    to_insert = base.createElement("c");
	    to_insert.appendChild(this.make_e(""));
	}
    }
    n.parentNode.setAttribute("s",parseInt(n.parentNode.getAttribute("s"))+1);
    n.parentNode.insertBefore(to_insert, before ? n : n.nextSibling);
    if(vertical) this.current = to_insert.firstChild.firstChild;
    else this.current = to_insert.firstChild;
    this.caret = 0;
    this.checkpoint();
}

GuppyBackend.prototype.list_remove_col = function(){
    var n = this.current;
    while(n.parentNode && n.parentNode.parentNode && !(n.nodeName == 'c' && n.parentNode.nodeName == 'l' && n.parentNode.parentNode.nodeName == 'l')){
	n = n.parentNode;
    }
    if(!n.parentNode) return;

    // Don't remove if there is only a single column:
    if(n.previousSibling != null){
	this.current = n.previousSibling.lastChild;
	this.caret = n.previousSibling.lastChild.firstChild.textContent.length;
    }
    else if(n.nextSibling != null){
	this.current = n.nextSibling.firstChild;
	this.caret = 0;
    }
    else return;

    var pos = 1;
    var cc = n;

    // Find position of column
    while(cc.previousSibling != null){
	pos++;
	cc = cc.previousSibling;
    }
    var to_modify = [];
    var iterator = this.doc.xpath_list("./l/c[position()="+pos+"]", n.parentNode.parentNode)
    try{ for(var nn = iterator.iterateNext(); nn != null; nn = iterator.iterateNext()){ to_modify.push(nn); }}
    catch(e) { this.fire_event("error",{"message":'XML modified during iteration? ' + e}); }
    for(var j = 0; j < to_modify.length; j++){
	var nn = to_modify[j];
	nn.parentNode.setAttribute("s",parseInt(nn.parentNode.getAttribute("s"))-1);
	nn.parentNode.removeChild(nn);
    }
}

GuppyBackend.prototype.list_remove_row = function(){
    var n = this.current;
    while(n.parentNode && !(n.nodeName == 'l' && n.parentNode.nodeName == 'l')){
	n = n.parentNode;
    }
    if(!n.parentNode) return;
    // Don't remove if there is only a single row:
    if(n.previousSibling != null){
	this.current = n.previousSibling.firstChild.lastChild;
	this.caret = n.previousSibling.lastChild.firstChild.textContent.length;
    }
    else if(n.nextSibling != null){
	this.current = n.nextSibling.firstChild.firstChild;
	this.caret = 0;
    }
    else return;

    n.parentNode.setAttribute("s",parseInt(n.parentNode.getAttribute("s"))-1);
    n.parentNode.removeChild(n);
}

GuppyBackend.prototype.list_remove = function(){
    var n = this.current;
    while(n.parentNode && !(n.nodeName == 'c' && n.parentNode.nodeName == 'l')){
	n = n.parentNode;
    }
    if(!n.parentNode) return;
    if(n.parentNode.parentNode && n.parentNode.parentNode.nodeName == "l"){
	this.list_remove_col();
	return;
    }
    if(n.previousSibling != null){
	this.current = n.previousSibling.lastChild;
	this.caret = n.previousSibling.lastChild.firstChild.textContent.length;
    }
    else if(n.nextSibling != null){
	this.current = n.nextSibling.firstChild;
	this.caret = 0;
    }
    else return;
    n.parentNode.setAttribute("s",parseInt(n.parentNode.getAttribute("s"))-1);
    n.parentNode.removeChild(n);
}

GuppyBackend.prototype.right = function(){
    this.sel_clear();
    if(this.caret >= GuppyUtils.get_length(this.current)){
	var nn = this.doc.xpath_node("following::e[1]", this.current);
	if(nn != null){
	    this.current = nn;
	    this.caret = 0;
	}
	else{
	    this.fire_event("right_end");
	}
    }
    else{
	this.caret += 1;
    }
}

GuppyBackend.prototype.spacebar = function(){
    this.space_caret = this.caret;
}

GuppyBackend.prototype.left = function(){
    this.sel_clear();
    if(this.caret <= 0){
	var pn = this.doc.xpath_node("preceding::e[1]", this.current);
	if(pn != null){
	    this.current = pn;
	    this.caret = this.current.firstChild.nodeValue.length;
	}
	else{
	    this.fire_event("left_end");
	}
    }
    else{
	this.caret -= 1;
    }
}

GuppyBackend.prototype.delete_from_c = function(){
    var pos = 0;
    var c = this.current.parentNode;
    while(c && c.nodeName == "c"){
	pos++;
	c = c.previousSibling;
    }
    var idx = this.current.parentNode.getAttribute("delete");
    var survivor_node = this.doc.xpath_node("./c[position()="+idx+"]", this.current.parentNode.parentNode);
    var survivor_nodes = [];
    for(var n = survivor_node.firstChild; n != null; n = n.nextSibling){
	survivor_nodes.push(n);
    }
    this.current = this.current.parentNode.parentNode;
    this.delete_from_f();
    this.insert_nodes(survivor_nodes, pos > idx);
}

GuppyBackend.prototype.delete_from_e = function(){
    // return false if we deleted something, and true otherwise.
    if(this.caret > 0){
	this.current.firstChild.nodeValue = this.current.firstChild.nodeValue.splicen(this.caret-1,"",1);
	this.caret--;
    }
    else{
	// The order of these is important
	if(this.current.previousSibling != null && this.current.previousSibling.getAttribute("c") == "yes"){
	    // The previous node is an f node but is really just a character.  Delete it.
	    this.current = this.current.previousSibling;
	    this.delete_from_f();
	}
	else if(this.current.previousSibling != null && this.current.previousSibling.nodeName == 'f'){
	    // We're in an e node just after an f node.  Move back into the f node (delete it?)
	    this.left();
	    return false;
	}
	else if(this.current.parentNode.previousSibling != null && this.current.parentNode.previousSibling.nodeName == 'c'){
	    // We're in a c child of an f node, but not the first one.  Go to the previous c
	    if(this.current.parentNode.hasAttribute("delete")){
		this.delete_from_c();
	    }
	    else{
		this.left();
		return false;
	    }
	}
	else if(this.current.previousSibling == null && this.current.parentNode.nodeName == 'c' && (this.current.parentNode.previousSibling == null || this.current.parentNode.previousSibling.nodeName != 'c')){
	    // We're in the first c child of an f node and at the beginning--delete the f node
	    var par = this.current.parentNode;
	    while(par.parentNode.nodeName == 'l' || par.parentNode.nodeName == 'c'){
		par = par.parentNode;
	    }
	    if(par.hasAttribute("delete")){
		this.delete_from_c();
	    }
	    else{
		this.current = par.parentNode;
		this.delete_from_f();
	    }
	}
	else{
	    // We're at the beginning (hopefully!)
	    return false;
	}
    }
    return true;
}

GuppyBackend.prototype.delete_forward_from_e = function(){
    // return false if we deleted something, and true otherwise.
    if(this.caret < this.current.firstChild.nodeValue.length){
	this.current.firstChild.nodeValue = this.current.firstChild.nodeValue.splicen(this.caret,"",1);
    }
    else{
	//We're at the end
	if(this.current.nextSibling != null){
	    // The next node is an f node.  Delete it.
	    this.current = this.current.nextSibling;
	    this.delete_from_f();
	}
	else if(this.current.parentNode.nodeName == 'c'){
	    // We're in a c child of an f node.  Do nothing
	    return false;
	}
    }
    return true;
}

GuppyBackend.prototype.backspace = function(){
    if(this.sel_status != GuppyBackend.SEL_NONE){
	this.sel_delete();
	this.sel_status = GuppyBackend.SEL_NONE;
	this.checkpoint();
    }
    else if(this.delete_from_e()){
	this.checkpoint();
    }
}

GuppyBackend.prototype.delete_key = function(){
    if(this.sel_status != GuppyBackend.SEL_NONE){
	this.sel_delete();
	this.sel_status = GuppyBackend.SEL_NONE;
	this.checkpoint();
    }
    else if(this.delete_forward_from_e()){
	this.checkpoint();
    }
}

GuppyBackend.prototype.backslash = function(){
    if(GuppyUtils.is_text(this.current)) return;
    this.insert_symbol("sym_name");
}

GuppyBackend.prototype.tab = function(){
    if(!GuppyUtils.is_symbol(this.current)){
	this.check_for_symbol();
	return;
    }
    var sym_name = this.current.firstChild.textContent;
    var candidates = [];
    for(var n in this.symbols){
	    if(n.startsWith(sym_name)) candidates.push(n);
    }
    for(n in GuppySymbols.symbols){
      if( n in this.symbols) continue;
	    if(n.startsWith(sym_name)) candidates.push(n);
    }

    if(candidates.length == 1){
	this.current.firstChild.textContent = candidates[0];
	this.caret = candidates[0].length;
    }
    else {
	this.fire_event("completion",{"candidates":candidates});
    }
}

GuppyBackend.prototype.right_paren = function(){
    if(this.current.nodeName == 'e' && this.caret < this.current.firstChild.nodeValue.length - 1) return;
    else this.right();
}

GuppyBackend.prototype.up = function(){
    this.sel_clear();
    if(this.current.parentNode.hasAttribute("up")){
	var t = parseInt(this.current.parentNode.getAttribute("up"));
	var f = this.current.parentNode.parentNode;
	var n = f.firstChild;
	while(n != null && t > 0){
	    if(n.nodeName == 'c') t--;
	    if(t > 0) n = n.nextSibling;
	}
	this.current = n.lastChild;
	this.caret = this.current.firstChild.nodeValue.length;
    }
    else this.list_vertical_move(false);
}

GuppyBackend.prototype.down = function(){
    this.sel_clear();
    if(this.current.parentNode.hasAttribute("down")){
	var t = parseInt(this.current.parentNode.getAttribute("down"));
	var f = this.current.parentNode.parentNode;
	var n = f.firstChild;
	while(n != null && t > 0){
	    if(n.nodeName == 'c') t--;
	    if(t > 0) n = n.nextSibling;
	}
	this.current = n.lastChild;
	this.caret = this.current.firstChild.nodeValue.length;
    }
    else this.list_vertical_move(true);
}

GuppyBackend.prototype.home = function(){
    this.current = this.doc.root().firstChild;
    this.caret = 0;
}

GuppyBackend.prototype.end = function(){
    this.current = this.doc.root().lastChild;
    this.caret = this.current.firstChild.nodeValue.length;
}

GuppyBackend.prototype.checkpoint = function(){
    var base = this.doc.base;
    this.current.setAttribute("current","yes");
    this.current.setAttribute("caret",this.caret.toString());
    this.undo_now++;
    this.undo_data[this.undo_now] = base.cloneNode(true);
    this.undo_data.splice(this.undo_now+1, this.undo_data.length);
    this.fire_event("change",{"old":this.undo_data[this.undo_now-1],"new":this.undo_data[this.undo_now]});
    this.current.removeAttribute("current");
    this.current.removeAttribute("caret");
}

GuppyBackend.prototype.restore = function(t){
    this.doc.base = this.undo_data[t].cloneNode(true);
    this.find_current();
    this.current.removeAttribute("current");
    this.current.removeAttribute("caret");
}

GuppyBackend.prototype.find_current = function(){
    this.current = this.doc.xpath_node("//*[@current='yes']");
    this.caret = parseInt(this.current.getAttribute("caret"));
}

GuppyBackend.prototype.undo = function(){
    if(this.undo_now <= 0) return;
    this.undo_now--;
    this.restore(this.undo_now);
}

GuppyBackend.prototype.redo = function(){
    if(this.undo_now >= this.undo_data.length-1) return;
    this.undo_now++;
    this.restore(this.undo_now);
}

GuppyBackend.prototype.done = function(s){
    if(GuppyUtils.is_symbol(this.current)) this.complete_symbol();
    else this.fire_event("done");
}

GuppyBackend.prototype.complete_symbol = function(){
    var sym_name = this.current.firstChild.textContent;
    if(!(GuppySymbols.symbols[sym_name])  && !this.symbols[sym_name]) return;
    this.current = this.current.parentNode.parentNode;
    this.delete_from_f();
    this.insert_symbol(sym_name);
}

GuppyBackend.prototype.problem = function(message){
    this.fire_event("error",{"message":message});
}

GuppyBackend.prototype.is_blacklisted = function(symb_type){
    for(var i = 0; i < this.blacklist.length; i++)
	if(symb_type == this.blacklist[i]) return true;
    return false;
}

GuppyBackend.prototype.check_for_symbol = function(){
    var instance = this;
    if(GuppyUtils.is_text(this.current)) return;
    var all_symbols = this.symbols;
    for(var s in GuppySymbols.symbols){
      if(s in all_symbols) continue;
      all_symbols.push(s);
    }
    for(s in all_symbols){
    	if(instance.current.nodeName == 'e' && s.length <= (instance.caret - instance.space_caret) && !(GuppyUtils.is_blank(instance.current)) && instance.current.firstChild.nodeValue.search_at(instance.caret,s)){
    	    var temp = instance.current.firstChild.nodeValue;
    	    var temp_caret = instance.caret;
    	    instance.current.firstChild.nodeValue = instance.current.firstChild.nodeValue.slice(0,instance.caret-s.length)+instance.current.firstChild.nodeValue.slice(instance.caret);
    	    instance.caret -= s.length;
    	    var success = instance.insert_symbol(s);
    	    if(!success){
        		instance.current.firstChild.nodeValue = temp;
        		instance.caret = temp_caret;
    	    }
    	    break;
    	}
    }
}

GuppyBackend.prototype.symb_raw = function(symb_name,latex_symb,text_symb){
    this.symbols[symb_name] = {"output":{"latex":[latex_symb],
					     "text":[text_symb]},
				   "char":true,
				   "type":symb_name};
}

GuppyBackend.prototype.symb_func = function(func_name){
    this.symbols[func_name] = {"output":{"latex":"\\"+func_name+"\\left({$1}\\right)",
					     "text":func_name+"({$1})"},
				   "type":func_name,
				   "attrs":{
				       "delete":[1]
				   }
				  };
}

module.exports = GuppyBackend;
