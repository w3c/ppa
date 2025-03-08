The PAT working group will use a process similar to others that have employed a GitHub-centric mode of work. The process summary is as follows, and we should note that this is subject to change as we get closer to a final specification:

* To access GitHub, you choose an interface, e.g., [command line interface](https://docs.github.com/en/github-cli), [GitHub mobile](https://docs.github.com/en/get-started/using-github/github-mobile), [GitHub desktop](https://docs.github.com/en/desktop), [VSCode](https://code.visualstudio.com/docs/sourcecontrol/github), or Browser.
* To start a discussion, you generate an [Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue). Most of the discussion happens on/in an Issue.
* To suggest a change, you generate a [Pull Request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request).  “Discussions” about specific wording changes for a Pull Request occur on/in the PR.
* To make a change, editors and, in rare circumstances, Chairs “merge” the Pull Request; issues related to PRs will be autoclosed with [link](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).
* To publish a new version of the specification, GitHub plus some [W3C Tooling](https://github.com/w3c/echidna?tab=readme-ov-file) takes care of this [within minutes](https://www.w3.org/2021/03/18-echidna/?full#1) of the PR being merged.
* To track what has happened, you can consult the GitHub logs; GitHub logs everything -- all issues, discussions about issues, labels, label changes, and specification changes, etc.
* To stay informed, you can either “watch” the [PPA repo](https://github.com/w3c/ppa) or check your email: the repo’s notifications are copied to the [PAT working group mailing list](https://lists.w3.org/Archives/Public/public-patwg/).

What follows is a more detailed explanation of the process.

Not all Issues are created equal. Some Issues are editorial; some are noncontroversial, non-editorial; and some are controversial. More process is required for controversial Issues than for noncontroversial Issues.

While nobody wants their Issue to be controversial and most do not start out that way, it happens and when it does the chairs get involved to (if necessary) mediate the discussion and to (chair only function) judge consensus on the way forward. We will use [Labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels), `discuss`, `needs consensus`, `call-for-consensus`, and `has consensus`, to move through the process. `discuss` is notice that the Issue needs to be discussed; can be applied by anyone. `needs consensus` is a request for the chairs step in; can be applied by anyone. `call-for-consensus` indicates that the PR or Issue is ready for working group participants to reach consensus; can only be applied by the chairs. `has consensus` is an indication to the editors that the Issue has consensus and work on the Pull Request can proceed or that the Pull Request can be merged; can only be applied by the chairs. If there is no consensus to merge the Issue/PR will be closed; GitHub also supports reopening Issues and PRs if there is new information. If you apply a Label, please add a comment to explain your understanding of the current state of the Issue and why you are applying the Label, e.g., discussed during interim meeting and the analysis in [link to comment] was supported, marking as `has consensus`.

Editorial issues need to be dispatched quickly, and the process is as follows:

* You submit a Pull Request to make the change; as noted earlier, editorial issues do not require that an Issue be filed.
* You apply the `editorial` Label.
* Editors will merge the Pull Request when appropriate
  * If the editors or chairs disagree with the `editorial` label, they will apply the `discuss` Label.

For noncontroversial, non-editorial issues:
  * You file an Issue.
  * You add one or more Assignee(s) or one or more Assignee(s) will be selected during the discussion.
    * If at some point during the discussion, the Issue ceases to be noncontroversial, non-editorial the `discuss` Label will be applied.
  * The Assignee(s) submit(s) a Pull Request to address the issue; [link](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue) to the Issue to allow for autoclose.
  * Editors will judge when the Pull Request is ready and when it is they will merge the Pull Request.
