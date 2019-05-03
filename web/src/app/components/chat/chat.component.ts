import { Component, OnInit, ViewChildren, ViewChild, AfterViewInit, QueryList, ElementRef, OnDestroy } from '@angular/core';
import { MatDialog, MatDialogRef, MatList, MatListItem, MatSnackBar, MatSnackBarRef, SimpleSnackBar } from '@angular/material';

import { ChatService } from '../../services/chat.service';
import { CryptoService } from '../../services/crypto.service';

import { Action, User, Message, Event, DialogUserType, Channel, DialogParams } from '../../models';
import { DialogUserComponent } from '../dialog-user/dialog-user.component';
import { Router } from '@angular/router';

const  WELCOMEMESSAGE = `
  Welcome to safer.chat, a really good place to chat,
  all the messages here are end-to-end encrypted which
  means that only the participants in the channel can read them.
  share your channel name and password and enjoy`;

const SAFERCHAT = 'safer.chat';
const POP_UP_MSJ_DURATION_MS = 1000; // 10 seg
const INTERVAL_FOR_CONNECTION_MS = 60000; // 60 seg

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, AfterViewInit, OnDestroy {

  event = Event;
  action = Action;
  user: User;
  channel: Channel;
  peers: User[] = [];
  messages: Message[] = [];
  messageContent: string;
  dialogRef: MatDialogRef<DialogUserComponent> | null;
  errorMessages: MatSnackBarRef<SimpleSnackBar>;
  intervalForConection;

  dialogParams: DialogParams;

  constructor(
    private cryptoService: CryptoService,
    private chatService: ChatService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private router: Router ) {}

  // getting a reference to the overall list, which is the parent container of the list items
  @ViewChild(MatList, { read: ElementRef }) matList: ElementRef;

  // getting a reference to the items/messages within the list
  @ViewChildren(MatListItem, { read: ElementRef }) matListItems: QueryList<MatListItem>;

  ngOnInit(): void {
    this.user = this.chatService.getUser();
    if (this.user === undefined) {
      this.router.navigateByUrl('');
    }

    this.channel = this.chatService.getChannnel();
    this.peers = this.chatService.getInitialPeers();
    this.initIoConnection();

    this.intervalForConection = setInterval(() => {
      this.sendEmptyMessage(this.chatService);
    }, INTERVAL_FOR_CONNECTION_MS);
  }

  ngOnDestroy(): void {
   clearInterval(this.intervalForConection);
  }


  private initIoConnection(): void {
    this.chatService.connect();

    this.chatService.messages.subscribe(
      message => {
        this.receiveMessages(message);
      },
      error => {
        this.errorMessages = this.snackBar.open('The server is not available, try again later');
      }, () => {
        this.chatService.connect();
      }
    );
  }

  private async receiveMessages(message) {
    switch (message.type) {
      case Event.PEER_JOINED:
      {
        const publicKey = await this.cryptoService.decodeBase64PublicKey(message.data.who.key);
        const newPeer: User = new User(message.data.who.name, publicKey, message.data.who.key);
        this.peers.push(newPeer);
        this.messages.push(new Message(newPeer, message.type));
        this.sendBrowserNotification(newPeer.name, Event.PEER_JOINED);
        break;
      }
      case Event.MESSAGE_RECEIVED:
      {
        const messageDecrypted = await this.cryptoService.decrypt(message.data.message);
        const fromUser: User = this.peers.find(peer => peer.name === message.data.from.name);
        this.messages.push(new Message(fromUser, message.type, messageDecrypted));
        this.sendBrowserNotification(fromUser.name, Event.MESSAGE_RECEIVED);
        break;
      }
      case Event.PEER_LEFT:
      {
        const userLeft: User = this.peers.find(peer => peer.name === message.data.who.name);
        const indexPeer: number = this.peers.findIndex(peer => peer.name === message.data.who.name);
        this.messages.push(new Message(userLeft, message.type));

        this.peers.splice(indexPeer, 1);
        this.sendBrowserNotification(userLeft.name, Event.PEER_LEFT);
        break;
      }
      case Event.COMMAND_REJECTED:
      {
        this.snackBar.open(message.data.reason, 'OK', {duration: POP_UP_MSJ_DURATION_MS});
        this.openUserPopup(this.dialogParams);
      }
    }
  }

  private sendEmptyMessage(chatService: ChatService) {
    this.chatService.connect();
    chatService.send({});
  }

  ngAfterViewInit(): void {
    // subscribing to any changes in the list of items / messages
    this.matListItems.changes.subscribe(elements => {
      this.scrollToBottom();
    });
  }

  private scrollToBottom(): void {
    try {
      this.matList.nativeElement.scrollTop = this.matList.nativeElement.scrollHeight;
    } catch (err) {
    }
  }

  public sendMessage(messageContent: string) {
    let message: any;

    if (!messageContent) {
      return;
    }

    this.peers.forEach(peer => {
      this.cryptoService
        .encrypt(messageContent, peer.publicKey)
        .then(encryptedMessage => {
          message = {
            type: Action.SENDMESSAGE,
            data: {
              to: peer.name,
              message: encryptedMessage
            }
          };
          this.chatService.send(message);
        });
    });
    this.messages.push(new Message(this.user, Event.MESSAGE_RECEIVED, messageContent));
    console.log(this.messages);
    this.messageContent = '';
  }

  private joinChannel(): void {
    const message = {
      type : Action.JOIN,
      data : {
        channel : this.channel.name,
        secret : this.channel.sha256Secret,
        name : {
          name : this.user.name,
          key: this.user.base64EncodedPublicKey
        }
      }
    };

    this.chatService.send(message);
  }

  private leaveChannel() {
    const message =  { type: Action.LEFT };
    this.chatService.send(message);
  }

  public onClickUserInfo() {
    this.openUserPopup({
      data: {
        nickname: this.user.name,
        title: 'Edit Details',
        dialogType: DialogUserType.EDIT,
        channel: this.channel.name,
        secret: this.channel.secret
      }
    });
  }

  private openUserPopup(params): void {
    this.dialogRef = this.dialog.open(DialogUserComponent, params);
    this.dialogRef.afterClosed().subscribe(async paramsDialog => {
      if (!paramsDialog) {
        return;
      }

      this.user = new User(
        paramsDialog.username,
        this.cryptoService.getPublicKey(),
        this.cryptoService.getBase64PublicKey());

      this.channel = new Channel(
        paramsDialog.channel,
        paramsDialog.secret);

      this.channel.sha256Secret = await this.cryptoService.sha256(paramsDialog.secret);
      // send notification to service
      this.chatService.setChannnel(this.channel);
      this.chatService.setUser(this.user);

      if (paramsDialog.dialogType === DialogUserType.EDIT) {
        this.leaveChannel();
        this.joinChannel();
      }
    });
  }

  private sendBrowserNotification (user: string, type: string) {

    let notificationMsj: string;

    if (document.hasFocus()) {
      return;
    }

    switch (type) {
      case Event.MESSAGE_RECEIVED : {
        notificationMsj = `New message from ${user}`;
        break;
      }
      case Event.PEER_JOINED: {
        notificationMsj = `${user} joined the channel`;
        break;
      }
      case Event.PEER_LEFT: {
        notificationMsj = `${user} left the channel`;
        break;
      }
    }

    if (!('Notification' in window)) {
      return;
    } else if (Notification.permission === 'granted') {
      const _ = new Notification(notificationMsj);
    }
  }
}