/* https://github.com/adobe/brackets/blob/master/src/extensions/default/JavaScriptQuickEdit/main.js */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, brackets, $ */

define(function (require, exports, module) {
    "use strict";
    
    // Brackets modules
    var MultiRangeInlineEditor  = brackets.getModule("editor/MultiRangeInlineEditor").MultiRangeInlineEditor,
        FileIndexManager        = brackets.getModule("project/FileIndexManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        DocumentManager         = brackets.getModule("document/DocumentManager"),
        JSUtils                 = brackets.getModule("language/JSUtils"),
        PerfUtils               = brackets.getModule("utils/PerfUtils"),
        NGUtils                 = require("NGUtils");
    
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
        
        return token.string;
    }
    
    /**
     * @private
     * For unit and performance tests. Allows lookup by function name instead of editor offset
     * without constructing an inline editor.
     *
     * @param {!string} functionName
     * @return {$.Promise} a promise that will be resolved with an array of function offset information
     */
    function _findInProject(functionName) {
        var result = new $.Deferred();
        
        FileIndexManager.getFileInfoList("all")
            .done(function (fileInfos) {
                PerfUtils.markStart(PerfUtils.ANGULARJS_FIND_DIRECTIVE);
                
                NGUtils.findMatchingDirectives(functionName, fileInfos)
                    .done(function (functions) {
                        PerfUtils.addMeasurement(PerfUtils.ANGULARJS_FIND_DIRECTIVE);
                        result.resolve(functions);
                    })
                    .fail(function () {
                        PerfUtils.finalizeMeasurement(PerfUtils.ANGULARJS_FIND_DIRECTIVE);
                        result.reject();
                    });
            })
            .fail(function () {
                result.reject();
            });
        
        return result.promise();
    }
    
    /**
     * @private
     * For unit and performance tests. Allows lookup by function name instead of editor offset .
     *
     * @param {!Editor} hostEditor
     * @param {!string} functionName
     * @return {$.Promise} a promise that will be resolved with an InlineWidget
     *      or null if we're not going to provide anything.
     */
    function _createInlineEditor(hostEditor, functionName) {
        // Use Tern jump-to-definition helper, if it's available, to find InlineEditor target.
        var helper = brackets._jsCodeHintsHelper;
        if (helper === null) {
            return null;
        }

        var result = new $.Deferred();
        PerfUtils.markStart(PerfUtils.ANGULARJS_INLINE_CREATE);

        var response = helper();
        if (response.hasOwnProperty("promise")) {
            response.promise.done(function (jumpResp) {
                var resolvedPath = jumpResp.fullPath;
                if (resolvedPath) {

                    // Tern doesn't always return entire function extent.
                    // Use QuickEdit search now that we know which file to look at.
                    var fileInfos = [];
                    fileInfos.push({name: jumpResp.resultFile, fullPath: resolvedPath});
                    // JSUtils.findMatchingFunctions(functionName, fileInfos, true)
                    NGUtils.findMatchingDirectives(functionName, fileInfos, true)
                        .done(function (functions) {
                            if (functions && functions.length > 0) {
                                var jsInlineEditor = new MultiRangeInlineEditor(functions);
                                jsInlineEditor.load(hostEditor);
                                
                                PerfUtils.addMeasurement(PerfUtils.ANGULARJS_INLINE_CREATE);
                                result.resolve(jsInlineEditor);
                            } else {
                                // No matching functions were found
                                PerfUtils.addMeasurement(PerfUtils.ANGULARJS_INLINE_CREATE);
                                result.reject();
                            }
                        })
                        .fail(function () {
                            PerfUtils.addMeasurement(PerfUtils.ANGULARJS_INLINE_CREATE);
                            result.reject();
                        });

                } else {        // no result from Tern.  Fall back to _findInProject().

                    _findInProject(functionName).done(function (functions) {
                        if (functions && functions.length > 0) {
                            var jsInlineEditor = new MultiRangeInlineEditor(functions);
                            jsInlineEditor.load(hostEditor);
                            
                            PerfUtils.addMeasurement(PerfUtils.ANGULARJS_INLINE_CREATE);
                            result.resolve(jsInlineEditor);
                        } else {
                            // No matching functions were found
                            PerfUtils.addMeasurement(PerfUtils.ANGULARJS_INLINE_CREATE);
                            result.reject();
                        }
                    }).fail(function () {
                        PerfUtils.finalizeMeasurement(PerfUtils.ANGULARJS_INLINE_CREATE);
                        result.reject();
                    });
                }

            }).fail(function () {
                PerfUtils.finalizeMeasurement(PerfUtils.ANGULARJS_INLINE_CREATE);
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
    function directiveProvider(hostEditor, pos) {
        // Only provide a JavaScript editor when cursor is in JavaScript content
        if (hostEditor.getModeForSelection() !== "html") {
            return null;
        }
        
        // Only provide JavaScript editor if the selection is within a single line
        var sel = hostEditor.getSelection();
        if (sel.start.line !== sel.end.line) {
            return null;
        }

        // Always use the selection start for determining the function name. The pos
        // parameter is usually the selection end.        
        var functionName = _getDirectiveName(hostEditor, sel.start);
        if (!functionName) {
            return null;
        }

        return _createInlineEditor(hostEditor, functionName);
    }

    // init
    EditorManager.registerInlineEditProvider(directiveProvider);
    PerfUtils.createPerfMeasurement("ANGULARJS_INLINE_CREATE", "AngularJS Inline Editor Creation");
    PerfUtils.createPerfMeasurement("ANGULARJS_FIND_DIRECTIVE", "AngularJS Find Directive");
    
    // for unit tests only
    exports.directiveProvider       = directiveProvider;
    exports._createInlineEditor     = _createInlineEditor;
    exports._findInProject          = _findInProject;
});