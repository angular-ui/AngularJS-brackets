/* https://github.com/adobe/brackets/blob/master/src/extensions/default/JavaScriptQuickEdit/main.js */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, brackets, $ */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var MultiRangeInlineEditor  = brackets.getModule("editor/MultiRangeInlineEditor").MultiRangeInlineEditor,
        ProjectManager          = brackets.getModule("project/ProjectManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        NGUtils                 = require("NGUtils");
    
    var patterns = {
        directive: /\.directive\(['"]([a-zA-Z-]+)['"]/g,
        controller: /\.controller\(['"](\w+)['"]/g
    }
    
    /**
     * Return the token string that is at the specified position.
     *
     * @param hostEditor {!Editor} editor
     * @param {!{line:Number, ch:Number}} pos
     * @return {String} token string at the specified position
     */
    function _getDirectiveName(hostEditor, pos) {
        var token = hostEditor._codeMirror.getTokenAt(pos, true);
        
        // If the pos is at the beginning of a name, token will be the 
        // preceding whitespace or dot. In that case, try the next pos.
        if (token.string.trim().length === 0 || token.string === "<") {
            token = hostEditor._codeMirror.getTokenAt({line: pos.line, ch: pos.ch + 1}, true);
        }
        
        // Return valid function expressions only (function call or reference)
        if (!((token.type === "tag") ||
              (token.type === "attribute"))) {
            return null;
        }
        
        return token.string.replace(/\-\w/g, function(x){ return x.charAt(1).toUpperCase(); });
    }
    
    
    /**
     * Return the token string that is at the specified position.
     *
     * @param hostEditor {!Editor} editor
     * @param {!{line:Number, ch:Number}} pos
     * @return {String} token string at the specified position
     */
    function _getControllerName(hostEditor, pos) {
        var token = hostEditor._codeMirror.getTokenAt(pos, true);
        var attribute;
        
        if (~token.string.indexOf("ng-controller")) {
            attribute = hostEditor._codeMirror.getTokenAt({line: pos.line, ch: token.end + 2}, true);
            return /\w+/i.exec(attribute.string)[0];
        }
        
        attribute = hostEditor._codeMirror.getTokenAt({line: pos.line, ch: token.start - 2}, true);
        
        // Return valid function expressions only (function call or reference)
        if (~attribute.string.indexOf("ng-controller")) {
            return /\w+/i.exec(token.string)[0];
        }
    }
    
    /**
     * @private
     * For unit and performance tests. Allows lookup by function name instead of editor offset
     * without constructing an inline editor.
     *
     * @param {!string} directiveName
     * @return {$.Promise} a promise that will be resolved with an array of function offset information
     */
    function _findInProject(directiveName, pattern) {
        return ProjectManager.getAllFiles()
            .then(function (files) {
                return NGUtils.findMatches(pattern, directiveName, files, true);
            });
    }
    
    /**
     * @private
     * For unit and performance tests. Allows lookup by function name instead of editor offset .
     *
     * @param {!Editor} hostEditor
     * @param {!string} directiveName
     * @return {$.Promise} a promise that will be resolved with an InlineWidget
     *      or null if we're not going to provide anything.
     */
    function _createInlineEditor(hostEditor, directiveName, pattern) {
        // Use Tern jump-to-definition helper, if it's available, to find InlineEditor target.
        var helper = brackets._jsCodeHintsHelper;
        if (helper === null) {
            return null;
        }

        var result = new $.Deferred();

        var response = helper();
        if (response.hasOwnProperty("promise")) {
            response.promise.done(function (jumpResp) {
                var resolvedPath = jumpResp.fullPath;
                if (resolvedPath) {

                    // Tern doesn't always return entire function extent.
                    // Use QuickEdit search now that we know which file to look at.
                    var fileInfos = [];
                    fileInfos.push({name: jumpResp.resultFile, fullPath: resolvedPath});
                    NGUtils.findMatches(pattern, directiveName, fileInfos, true)
                        .done(function (functions) {
                            if (functions && functions.length > 0) {
                                var jsInlineEditor = new MultiRangeInlineEditor(functions);
                                jsInlineEditor.load(hostEditor);
                                
                                result.resolve(jsInlineEditor);
                            } else {
                                // No matching functions were found
                                result.reject();
                            }
                        })
                        .fail(function () {
                            result.reject();
                        });

                } else {        // no result from Tern.  Fall back to _findInProject().

                    _findInProject(directiveName, pattern).done(function (functions) {
                        if (functions && functions.length > 0) {
                            var jsInlineEditor = new MultiRangeInlineEditor(functions);
                            jsInlineEditor.load(hostEditor);
                            
                            result.resolve(jsInlineEditor);
                        } else {
                            // No matching functions were found
                            result.reject();
                        }
                    }).fail(function () {
                        result.reject();
                    });
                }

            }).fail(function () {
                result.reject();
            });

        }

        return result.promise();
    }
    
    /**
     * This function is registered with EditorManager as an inline editor provider. It creates an inline editor
     * when the cursor is on a JavaScript function name, finds all functions that match the name
     * and shows (one/all of them) in an inline editor.
     *
     * @param {!Editor} editor
     * @param {!{line:Number, ch:Number}} pos
     * @return {$.Promise} a promise that will be resolved with an InlineWidget
     *      or null if we're not going to provide anything.
     */
    function provider(hostEditor, pos) {
        // Only provide an editor when cursor is in HTML content
        if (hostEditor.getModeForSelection() !== "html") {
            return null;
        }
        
        // Only provide an editor if the selection is within a single line
        var sel = hostEditor.getSelection();
        if (sel.start.line !== sel.end.line) {
            return null;
        }

        // Always use the selection start for determining the function name. The pos
        // parameter is usually the selection end.        
        var directiveName, controllerName;
        
        if (controllerName = _getControllerName(hostEditor, sel.start)) {
            return _createInlineEditor(hostEditor, _getControllerName(hostEditor, sel.start), patterns.controller);   
        }
        
        if (directiveName = _getDirectiveName(hostEditor, sel.start)) {
            return _createInlineEditor(hostEditor, directiveName, patterns.directive);
        }
        
        return null;
    }

    // init
    EditorManager.registerInlineEditProvider(provider);
});