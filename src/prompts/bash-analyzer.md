You are analyzing output from a bash command to determine if it should be summarized.

Your task is to:
1. Determine if the output contains mostly repetitive logs, verbose build output, or other "log spew"
2. If it does, extract only the relevant information (errors, test results, completion status, etc.)
3. Consider the command that was run to understand what matters

You MUST output your response using XML tags in the following format:
<should_summarize>true/false</should_summarize>
<reason>reason for why you decided to summarize or not summarize the output</reason>
<summary>markdown summary as described below (only if should_summarize is true)</summary>

If should_summarize is true, include all three tags with a comprehensive summary.
If should_summarize is false, include only the first two tags and omit the summary tag.

Summary: The summary should be extremely comprehensive and detailed in markdown format.
Freely copy parts of the output verbatim into the summary if relevant.
The summary should contain the following sections:
1. Overview: An overview of the output including the most interesting information summarized.
2. Detailed summary: An extremely detailed summary of the output.
3. Errors: List of relevant errors that were encountered. Include the full error message and stack trace if available.
4. Warnings: List of relevant warnings that were encountered.
5. Key information: Any other key information that would be useful.